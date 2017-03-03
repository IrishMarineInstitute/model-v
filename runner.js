// Run this from the commandline:
// phantomjs runner.js
// ffmpeg -y -c:v png -f image2 -s 800x600 -start_number 1 -i /tmp/img%04d -r 30 -c:v libx264 -pix_fmt yuv420p -movflags +faststart output.mp4

//var netcdfjs = require('netcdfjs');
var webPage = require('webpage');
var page = webPage.create();
var address = 'http://spiddal.marine.ie/tomasz/', //'http://127.0.0.1/',
    duration = 52, // duration of the video, in seconds
    framerate = 30, // number of frames per second. 24 is a good value.
    counter = 0,
    width = 800,
    height = 600;

page.onConsoleMessage = function(msg, lineNum, sourceId) {
  //console.log('CONSOLE: ' + msg + ' (from line #' + lineNum + ' in "' + sourceId + '")');
};
page.onError = function(msg, trace) {
  var msgStack = ['PHANTOM ERROR: ' + msg];
  if (trace && trace.length) {
    msgStack.push('TRACE:');
    trace.forEach(function(t) {
      msgStack.push(' -> ' + (t.file || t.sourceURL) + ': ' + t.line + (t.function ? ' (in function ' + t.function +')' : ''));
    });
  }
  console.error(msgStack.join('\n'));
  phantom.exit(1);
};

var capture = function(){
      page.clipRect = { top: 0, left: 0, width: width, height: height };
      counter++;
      var fname = "00000000000000"+counter;
      fname = "img"+fname.substring(fname.length-4);
      //console.log("frame "+counter+"/"+(duration * framerate));
      page.render('/tmp/'+fname, { format: 'png' });
      if (counter > duration * framerate) {
          phantom.exit();
      }
      return false;
};

page.onCallback = function(data){
   if (data.type === "capture"){
      capture();
   }
}

page.viewportSize = { width: width, height: height };

page.open(address, function(status) {
    if (status !== 'success') {
        console.log('Unable to load ',address);
        phantom.exit(1);
    } else {
        var hide_zoom_slider = 'var unwanted = document.getElementById("mapCanvas_zoom_slider");';
        hide_zoom_slider += 'if(unwanted) unwanted.style.visibility = "hidden"; ';
        var call_phantom = "window.callPhantom({ type: 'capture'});";
        page.evaluate("function(){ window.capturer = {capture: function(){" +hide_zoom_slider+call_phantom+"} }}");
        console.log("ready to capture video");
    }
});
