# cadl-json-schema

This repository is a collection of tools for working with JSON Schema and Cadl. This is very much a work in progress!

## Getting started

This package requires Node 18.3 or above!

We're not on npm yet, so use the following process to clone this repository and build the assets:

```bash
> git clone https://github.com/bterlson/cadl-json-schema
> cd cadl-json-schema
> npm install
> npm run build
```

## `json2cadl`

This tool converts JSON schema (draft 4 or above) into a Cadl file. It takes a list of json schema files as positional arguments.

```bash
npm run json2cadl path/to/test.yaml
```

json2cadl supports both JSON and Yaml documents. There are a number of features that are not yet (or will never be) supported including (but not limited to)

* patternProperties
* if/else conditions
* open tuples