var connect = require('connect');
var serveStatic = require('serve-static');
connect().use(serveStatic(__dirname+"/html")).listen(80, function(){
    console.log('Server running on port 80 ...');
});
var exec = require('child_process').exec;
function log(error, stdout, stderr) { console.log(stdout) }
// Run this from the commandline:
var phantom = "/usr/bin/phantomjs runner.js"
var ffmpeg = "/usr/local/bin/ffmpeg -y -c:v png -f image2 -s 800x600 -start_number 1 -i /tmp/img%04d -r 30 -c:v libx264 -pix_fmt yuv420p -movflags +faststart /output/video.mp4"
exec(phantom.split(), function(err,out,code){
  console.log(out);
  console.log(err);
  if (err instanceof Error)
    throw err;
  if(code){
     process.exit(code);
  } 
  exec(ffmpeg.split(), function(err,out,code){
     console.log(out);
     console.log(err);
     if (err instanceof Error)
       throw err;
     if(code == 0){
       console.log("the video should be in /output/video.mp4");
     }
     process.exit(code);
  });
});
