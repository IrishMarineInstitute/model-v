# model-v
Create a video file (MP4) using modelled data served from Erddap

# Build it like this
`docker build -t model-v .`

# Run it like this
`docker run -i -t --rm -v $(pwd)/output:/output model-v`

Nothing happens for a long time then the process will finish and the video will be in the output folder

There are lots of credits to be added here, but now it is the weekend....
