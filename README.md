# model-v
Create a video file (MP4) using modelled data served from Erddap

# Build it like this
`docker build -t model-v .`

# start the webserver like this
`docker run -d -p 8080:80 --name=model-v model-v`

# Update the video
Updating the video takes several minutes, and can be done like this:
`docker exec -i -t model-v record-model-v`

Video should appear in localhost:8080/model-v/connemara/


There are lots of credits to be added here...
