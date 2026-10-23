FROM --platform=linux/amd64 ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl wget zip unzip openjdk-11-jre-headless libncurses5 python3 pciutils gettext rpm2cpio cpio sudo libwebkit2gtk-4.0-37 expect && rm -rf /var/lib/apt/lists/*
RUN useradd -m tizen
USER tizen
WORKDIR /home/tizen
RUN wget -q https://download.tizen.org/sdk/Installer/tizen-studio_6.1/web-cli_Tizen_Studio_6.1_ubuntu-64.bin -O inst.bin && chmod +x inst.bin && ./inst.bin --accept-license /home/tizen/tizen-studio && rm inst.bin
ENV PATH=/home/tizen/tizen-studio/tools:/home/tizen/tizen-studio/tools/ide/bin:$PATH
