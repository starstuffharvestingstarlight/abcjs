// abc_editor.js
// window.ABCJS.Editor is the interface class for the area that contains the ABC text. It is responsible for
// holding the text of the tune and calling the parser and the rendering engines.
//
// EditArea is an example of using a textarea as the control that is shown to the user. As long as
// the same interface is used, window.ABCJS.Editor can use a different type of object.
//
// EditArea:
// - constructor(textareaid)
//		This contains the id of a textarea control that will be used.
// - addSelectionListener(listener)
//		A callback class that contains the entry point fireSelectionChanged()
// - addChangeListener(listener)
//		A callback class that contains the entry point fireChanged()
// - getSelection()
//		returns the object { start: , end: } with the current selection in characters
// - setSelection(start, end)
//		start and end are the character positions that should be selected.
// - getString()
//		returns the ABC text that is currently displayed.
// - setString(str)
//		sets the ABC text that is currently displayed, and resets the initialText variable
// - getElem()
//		returns the textarea element
// - string initialText
//		Contains the starting text. This can be compared against the current text to see if anything changed.
//

/*global document, window, clearTimeout, setTimeout */
/*global Raphael */

if (!window.ABCJS)
	window.ABCJS = {};

if (!window.ABCJS.edit)
	window.ABCJS.edit = {};

window.ABCJS.edit.EditArea = function(textareaid) {
  this.textarea = document.getElementById(textareaid);
  this.initialText = this.textarea.value;
  this.isDragging = false;
}

window.ABCJS.edit.EditArea.prototype.addSelectionListener = function(listener) {
  this.textarea.onmousemove = function(ev) {
	  if (this.isDragging)
	    listener.fireSelectionChanged();
  };
};

window.ABCJS.edit.EditArea.prototype.addChangeListener = function(listener) {
  this.changelistener = listener;
  this.textarea.onkeyup = function() {
    listener.fireChanged();
  };
  this.textarea.onmousedown = function() {
	this.isDragging = true;
    listener.fireSelectionChanged();
  };
  this.textarea.onmouseup = function() {
	this.isDragging = false;
    listener.fireChanged();
  };
  this.textarea.onchange = function() {
    listener.fireChanged();
  };
};

//TODO won't work under IE?
window.ABCJS.edit.EditArea.prototype.getSelection = function() {
  return {start: this.textarea.selectionStart, end: this.textarea.selectionEnd};
};

window.ABCJS.edit.EditArea.prototype.setSelection = function(start, end) {
	if(this.textarea.setSelectionRange)
	   this.textarea.setSelectionRange(start, end);
	else if(this.textarea.createTextRange) {
		// For IE8
	   var e = this.textarea.createTextRange();
	   e.collapse(true);
	   e.moveEnd('character', end);
	   e.moveStart('character', start);
	   e.select();
	}
  this.textarea.focus();
};

window.ABCJS.edit.EditArea.prototype.getString = function() {
  return this.textarea.value;
};

window.ABCJS.edit.EditArea.prototype.setString = function(str) {
  this.textarea.value = str;
  this.initialText = this.getString();
  if (this.changelistener) {
    this.changelistener.fireChanged();
  }
};

window.ABCJS.edit.EditArea.prototype.getElem = function() {
  return this.textarea;
};

//
// window.ABCJS.Editor:
//
// constructor(editarea, params)
//		if editarea is a string, then it is an HTML id of a textarea control.
//		Otherwise, it should be an instantiation of an object that expresses the EditArea interface.
//
//		params is a hash of:
//		canvas_id: or paper_id: HTML id to draw in. If not present, then the drawing happens just below the editor.
//		generate_midi: if present, then midi is generated.
//		midi_id: if present, the HTML id to place the midi control. Otherwise it is placed in the same div as the paper.
//		midi_download_id: if present, the HTML id to place the midi download link. Otherwise it is placed in the same div as the paper.
//		generate_warnings: if present, then parser warnings are displayed on the page.
//		warnings_id: if present, the HTML id to place the warnings. Otherwise they are placed in the same div as the paper.
//		onchange: if present, the callback function to call whenever there has been a change.
//		gui: if present, the paper can send changes back to the editor (presumably because the user changed something directly.)
//		parser_options: options to send to the parser engine.
//		midi_options: options to send to the midi engine.
//		render_options: options to send to the render engine.
//		indicate_changed: the dirty flag is set if this is true.
//
// - setReadOnly(bool)
//		adds or removes the class abc_textarea_readonly, and adds or removes the attribute readonly=yes
// - setDirtyStyle(bool)
//		adds or removes the class abc_textarea_dirty
// - renderTune(abc, parserparams, div)
//		Immediately renders the tune. (Useful for creating the SVG output behind the scenes, if div is hidden)
//		string abc: the ABC text
//		parserparams: params to send to the parser
//		div: the HTML id to render to.
// - modelChanged()
//		Called when the model has been changed to trigger re-rendering
// - parseABC()
//		Called internally by fireChanged()
//		returns true if there has been a change since last call.
// - updateSelection()
//		Called when the user has changed the selection. This calls the engraver_controller to show the selection.
// - fireSelectionChanged()
//		Called by the textarea object when the user has changed the selection.
// - paramChanged(engraverparams)
//		Called to signal that the engraver params have changed, so re-rendering should occur.
// - fireChanged()
//		Called by the textarea object when the user has changed something.
// - setNotDirty()
//		Called by the client app to reset the dirty flag
// - isDirty()
//		Returns true or false, whether the textarea contains the same text that it started with.
// - highlight(abcelem)
//		Called by the engraver_controller to highlight an area.
// - pause(bool)
//		Stops the automatic rendering when the user is typing.
//

window.ABCJS.Editor = function(editarea, params) {
	if (params.indicate_changed)
		this.indicate_changed = true;
  if (typeof editarea === "string") {
    this.editarea = new window.ABCJS.edit.EditArea(editarea);
  } else {
    this.editarea = editarea;
  }
  this.editarea.addSelectionListener(this);
  this.editarea.addChangeListener(this);

  if (params.canvas_id) {
    this.div = document.getElementById(params.canvas_id);
  } else if (params.paper_id) {
    this.div = document.getElementById(params.paper_id);
  } else {
    this.div = document.createElement("DIV");
    this.editarea.getElem().parentNode.insertBefore(this.div, this.editarea.getElem());
  }

	// If the user wants midi, then store the elements that it will be written to. The element could either be passed in as an id,
	// an element, or nothing. If nothing is passed in, then just put the midi on top of the generated music.
	if (params.generate_midi) {
		this.midiParams = params.midi_options || {};
		if (this.midiParams.generateDownload) {
			if (typeof params.midi_download_id === 'string')
				this.downloadMidi = document.getElementById(params.midi_download_id);
			else if (params.midi_download_id) // assume, if the var is not a string it is an element. If not, it will crash soon enough.
				this.downloadMidi = params.midi_download_id;
		}
		if (this.midiParams.generateInline !== false) { // The default for this is true, so undefined is also true.
			if (typeof params.midi_id === 'string')
				this.inlineMidi = document.getElementById(params.midi_id);
			else if (params.midi_id) // assume, if the var is not a string it is an element. If not, it will crash soon enough.
				this.inlineMidi = params.midi_id;
		}
	}

  if (params.generate_warnings || params.warnings_id) {
    if (params.warnings_id) {
      this.warningsdiv = document.getElementById(params.warnings_id);
    } else {
      this.warningsdiv = this.div;
    }
  }
  
  this.parserparams = params.parser_options || {};
  this.onchangeCallback = params.onchange;

  this.engraverparams = params.render_options || {};
  
  if (params.gui) {
    this.target = document.getElementById(editarea);
    this.engraverparams.editable = true;
  } 
  this.oldt = "";
  this.bReentry = false;
  this.parseABC();
  this.modelChanged();

  this.addClassName = function(element, className) {
    var hasClassName = function(element, className) {
      var elementClassName = element.className;
      return (elementClassName.length > 0 && (elementClassName === className ||
        new RegExp("(^|\\s)" + className + "(\\s|$)").test(elementClassName)));
    };

    if (!hasClassName(element, className))
      element.className += (element.className ? ' ' : '') + className;
    return element;
  };

  this.removeClassName = function(element, className) {
    element.className = window.ABCJS.parse.strip(element.className.replace(
      new RegExp("(^|\\s+)" + className + "(\\s+|$)"), ' '));
    return element;
  };

  this.setReadOnly = function(readOnly) {
	  var readonlyClass = 'abc_textarea_readonly';
	  var el = this.editarea.getElem();
    if (readOnly) {
      el.setAttribute('readonly', 'yes');
	  this.addClassName(el, readonlyClass);
	} else {
      el.removeAttribute('readonly');
	  this.removeClassName(el, readonlyClass);
    }
  };
};

window.ABCJS.Editor.prototype.renderTune = function(abc, params, div) {
  var tunebook = new ABCJS.TuneBook(abc);
  var abcParser = window.ABCJS.parse.Parse();
  abcParser.parse(tunebook.tunes[0].abc, params); //TODO handle multiple tunes
  var tune = abcParser.getTune();
  var paper = Raphael(div, 800, 400);
  var engraver_controller = new ABCJS.write.EngraverController(paper, this.engraverparams);
  engraver_controller.engraveABC(tune);
};

window.ABCJS.Editor.prototype.modelChanged = function() {
  if (this.tunes === undefined) {
    if (this.downloadMidi !== undefined)
		this.downloadMidi.innerHTML = "";
    if (this.inlineMidi !== undefined)
		this.inlineMidi.innerHTML = "";
    this.div.innerHTML = "";
	return;
  }

  if (this.bReentry)
    return; // TODO is this likely? maybe, if we rewrite abc immediately w/ abc2abc
  this.bReentry = true;
  this.timerId = null;
  this.div.innerHTML = "";
  var paper = Raphael(this.div, 800, 400);
  this.engraver_controller = new ABCJS.write.EngraverController(paper, this.engraverparams);
  this.engraver_controller.engraveABC(this.tunes);
	this.tunes[0].engraver = this.engraver_controller;	// TODO-PER: We actually want an output object for each tune, not the entire controller. When refactoring, don't save data in the controller.
	var downloadMidiHtml = "";
	var inlineMidiHtml = "";
	if (this.midiParams && !this.midiPause) {
		for (var i = 0; i < this.tunes.length; i++) {
			var midi = window.ABCJS.midi.create(this.tunes[i], this.midiParams);

			if (this.midiParams.generateInline && this.midiParams.generateDownload) {
				downloadMidiHtml += window.ABCJS.midi.generateMidiDownloadLink(this.tunes[i], this.midiParams, midi.download, i);
				inlineMidiHtml += window.ABCJS.midi.generateMidiControls(this.tunes[i], this.midiParams, midi.inline, i);
			} else if (this.midiParams.generateInline)
				inlineMidiHtml += window.ABCJS.midi.generateMidiControls(this.tunes[i], this.midiParams, midi, i);
			else
				downloadMidiHtml += window.ABCJS.midi.generateMidiDownloadLink(this.tunes[i], this.midiParams, midi, i);
		}
		if (this.downloadMidi)
			this.downloadMidi.innerHTML = downloadMidiHtml;
		else
			this.div.innerHTML += downloadMidiHtml;
		if (this.inlineMidi)
			this.inlineMidi.innerHTML = inlineMidiHtml;
		else
			this.div.innerHTML += inlineMidiHtml;
	}
  if (this.warningsdiv) {
    this.warningsdiv.innerHTML = (this.warnings) ? this.warnings.join("<br />") : "No errors";
  } 
  if (this.target) {
    var textprinter = new window.ABCJS.transform.TextPrinter(this.target, true);
    textprinter.printABC(this.tunes[0]); //TODO handle multiple tunes
  }
  this.engraver_controller.addSelectListener(this);
  this.updateSelection();
  this.bReentry = false;
};

// Call this to reparse in response to the printing parameters changing
window.ABCJS.Editor.prototype.paramChanged = function(engraverparams) {
	this.engraverparams = engraverparams;
	this.oldt = "";
	this.fireChanged();
};

// return true if the model has changed
window.ABCJS.Editor.prototype.parseABC = function() {
  var t = this.editarea.getString();
  if (t===this.oldt) {
    this.updateSelection();
    return false;
  }
  
  this.oldt = t;
  if (t === "") {
	this.tunes = undefined;
	this.warnings = "";
	return true;
  }
  var tunebook = new ABCJS.TuneBook(t);
  
  this.tunes = [];
  this.warnings = [];
  for (var i=0; i<tunebook.tunes.length; i++) {
    var abcParser = new window.ABCJS.parse.Parse();
    abcParser.parse(tunebook.tunes[i].abc, this.parserparams); //TODO handle multiple tunes
    this.tunes[i] = abcParser.getTune();
    var warnings = abcParser.getWarnings() || [];
    for (var j=0; j<warnings.length; j++) {
      this.warnings.push(warnings[j]);
    }
  }
  return true;
};

window.ABCJS.Editor.prototype.updateSelection = function() {
  var selection = this.editarea.getSelection();
  try {
    this.engraver_controller.rangeHighlight(selection.start, selection.end);
  } catch (e) {} // maybe printer isn't defined yet?
};

window.ABCJS.Editor.prototype.fireSelectionChanged = function() {
  this.updateSelection();
};

window.ABCJS.Editor.prototype.setDirtyStyle = function(isDirty) {
	if (this.indicate_changed === undefined)
		return;
  var addClassName = function(element, className) {
    var hasClassName = function(element, className) {
      var elementClassName = element.className;
      return (elementClassName.length > 0 && (elementClassName === className ||
        new RegExp("(^|\\s)" + className + "(\\s|$)").test(elementClassName)));
    };

    if (!hasClassName(element, className))
      element.className += (element.className ? ' ' : '') + className;
    return element;
  };

  var removeClassName = function(element, className) {
    element.className = window.ABCJS.parse.strip(element.className.replace(
      new RegExp("(^|\\s+)" + className + "(\\s+|$)"), ' '));
    return element;
  };
  
	var readonlyClass = 'abc_textarea_dirty';
	var el = this.editarea.getElem();
	if (isDirty) {
		addClassName(el, readonlyClass);
	} else {
		removeClassName(el, readonlyClass);
    }
};

// call when abc text is changed and needs re-parsing
window.ABCJS.Editor.prototype.fireChanged = function() {
  if (this.bIsPaused)
    return;
  if (this.parseABC()) {
    var self = this;
    if (this.timerId)	// If the user is still typing, cancel the update
      clearTimeout(this.timerId);
    this.timerId = setTimeout(function () {
      self.modelChanged();
    }, 300);	// Is this a good comprimise between responsiveness and not redrawing too much?  
	  var isDirty = this.isDirty();
	  if (this.wasDirty !== isDirty) {
		  this.wasDirty = isDirty;
		  this.setDirtyStyle(isDirty);
	  }
	  if (this.onchangeCallback)
		  this.onchangeCallback(this);
	  }
};

window.ABCJS.Editor.prototype.setNotDirty = function() {
	this.editarea.initialText = this.editarea.getString();
	this.wasDirty = false;
	this.setDirtyStyle(false);
};

window.ABCJS.Editor.prototype.isDirty = function() {
	if (this.indicate_changed === undefined)
		return false;
	return this.editarea.initialText !== this.editarea.getString();
};

window.ABCJS.Editor.prototype.highlight = function(abcelem) {
  this.editarea.setSelection(abcelem.startChar, abcelem.endChar);
};

window.ABCJS.Editor.prototype.pause = function(shouldPause) {
	this.bIsPaused = shouldPause;
	if (!shouldPause)
		this.fireChanged();
};

window.ABCJS.Editor.prototype.pauseMidi = function(shouldPause) {
	this.midiPause = shouldPause;
};
