# The simplest Node.js setup.
FROM node:current-alpine

# Switch to the non-root user.
# The image already has user node, 1000:1000.
# id = 1000 is typical default uid/gid for the interactive Linux user;
# this also  helps when mounting directories.
USER node:node

# Install npm packages.
RUN mkdir -p /home/node/dist
COPY package.json /home/node/dist/package.json

# Copy sources.
RUN cd /home/node/dist && npm i


COPY ./dist /home/node/dist

# Run the server.
ENTRYPOINT cd /home/node/dist && node app.js
