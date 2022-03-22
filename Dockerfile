FROM node:16-bullseye

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app

RUN wget https://download.imagemagick.org/ImageMagick/download/binaries/magick
RUN chmod 777 ./magick
RUN chown node:node ./magick

RUN apt-get update \
    && apt-get install -y libfuse2 fuse

COPY --chown=node:node package*.json ./

USER node

RUN npm install

COPY --chown=node:node . .

CMD [ "npm", "run", "start" ]