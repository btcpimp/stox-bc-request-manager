# Request Manager

The Request Manager holds the data of all pending and confirmed requests related to the
blockchain. It acts as a manager service that sends and tracks the status of requests across all
microservices and handles their resolution process.

## Setup
install global packages
```
npm install lerna rimraf cross-env -g
```
Installs all of the packages dependencies and links any cross-dependencies
```
npm run setup
```
Remove all node_modules directories from all packages and run setup
```
npm run setup:clean
```
link stox-common package to all services
```
npm run link
```
run lint for all packages
```
npm run lint
```

##Build
To build a sub-system base image, you will need an id_rsa located at the root of the repository
```
docker build -f ./docker/Dockerfile -t request-manager --build-arg SSH_PRIVATE_KEY="$(cat ./id_rsa)" .
```
To run service containers:
```
npm run containers
```

## Tests
To run all unit test locally run

```
npm run test 
```

To run all integration tests in one container, first build the base image and then run:
```
npm run test:compose
```

## Docs
[Blockchain Writer Architecture](https://docs.google.com/document/d/1eXrxDFgjDl-2No22om8vesqGhU7iGtw8iDSuN3VoHJ4/edit#heading=h.jsy3plhn9pv8)
