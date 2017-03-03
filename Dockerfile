FROM nodesource/xenial

MAINTAINER Joshua Gardner mellowcellofellow@gmail.com

# Set Locale

RUN locale-gen en_US.UTF-8  
ENV LANG en_US.UTF-8  
ENV LANGUAGE en_US:en  
ENV LC_ALL en_US.UTF-8



# Enable Universe and Multiverse and install dependencies.

#RUN echo deb http://archive.ubuntu.com/ubuntu precise universe multiverse >> /etc/apt/sources.list; \
RUN  apt-get update; \
    apt-get -y install autoconf automake build-essential git mercurial cmake libass-dev libgpac-dev libtheora-dev libtool libvdpau-dev libvorbis-dev pkg-config texi2html zlib1g-dev libmp3lame-dev wget yasm openssl libssl-dev; \
    apt-get clean


WORKDIR /usr/local/src
RUN git clone --depth 1 https://github.com/l-smash/l-smash 
RUN cd l-smash && ./configure
RUN cd l-smash && make -j $(nproc)
RUN cd l-smash && make install

RUN git clone --depth 1 http://git.videolan.org/git/x264.git
RUN cd x264 && ./configure --enable-static
RUN cd x264 && make -j 8
RUN cd x264 && make install

RUN hg clone https://bitbucket.org/multicoreware/x265 
RUN cd x265/build/linux && cmake -DCMAKE_INSTALL_PREFIX:PATH=/usr ../../source
RUN cd x265/build/linux && make -j 8
RUN cd x265/build/linux && make install

RUN git clone --depth 1 https://github.com/mstorsjo/fdk-aac.git
RUN cd fdk-aac && autoreconf -fiv
RUN cd fdk-aac && ./configure --disable-shared 
RUN cd fdk-aac && make -j 8
RUN cd fdk-aac && make install

RUN git clone --depth 1 https://chromium.googlesource.com/webm/libvpx
RUN cd libvpx && ./configure --disable-examples
RUN cd libvpx && make -j 8
RUN cd libvpx && make install

RUN git clone https://git.xiph.org/opus.git
RUN cd opus && ./autogen.sh
RUN cd opus && ./configure --disable-shared
RUN cd opus && make -j 8
RUN cd opus && make install

RUN git clone https://github.com/FFmpeg/FFmpeg.git
RUN mv FFmpeg ffmpeg
RUN cd ffmpeg && \
    ./configure --extra-libs="-ldl" --enable-gpl --enable-libass \
                --enable-libfdk-aac --enable-libmp3lame \
                --enable-libopus --enable-libtheora --enable-libvorbis \
                --enable-libvpx --enable-libx264 --enable-libx265 \
                --enable-nonfree --enable-openssl 
RUN cd ffmpeg && make -j 8
RUN cd ffmpeg && make install

RUN git clone --depth 1 https://github.com/mulx/aacgain.git
RUN cd aacgain/mp4v2 && ./configure
RUN cd aacgain/mp4v2 && make -k -j 8
RUN cd aacgain/faad2 && ./configure
RUN cd aacgain/faad2 && make -k -j 8
RUN cd aacgain && ./configure
RUN cd aacgain && make -j 8 && make install

RUN npm install -g phantomjs-prebuilt

WORKDIR /usr/src/app
RUN npm install connect serve-static
RUN mkdir /output
COPY index.js /usr/src/app/
COPY runner.js /usr/src/app/
COPY package.json /usr/src/app/
COPY html /usr/src/app/html

# RUN rm -rf /usr/local/src

# CMD ["/bin/bash"]
