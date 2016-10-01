/**
 * Created by anton on 01.10.16.
 */

var path = require('path');
var Promise = require('bluebird');
var debug = require('debug')('storage');
var fs = require('fs');

var promiseList = {};

var inStack = function (key, fn) {
    return new Promise(function (resolve, reject) {
        var promise = promiseList[key] || Promise.resolve();

        promise = promise.then(function () {
            return Promise.try(fn).then(resolve, reject);
        });

        promiseList[key] = promise;
    });
};

var Storage = function() {
    "use strict";
    var storagePath = path.join(__dirname, './storage');

    var accessFile = function (keyPath, mode) {
        return new Promise(function (resilve, reject) {
            fs.access(keyPath, mode, function (err) {
                if (err) {
                    reject(err);
                } else {
                    resilve();
                }
            });
        });
    };

    var readKey = function (key) {
        var readFile = function (keyPath) {
            return new Promise(function (resilve, reject) {
                fs.readFile(keyPath, {
                    encoding: 'utf8'
                }, function (err, data) {
                    if (err) {
                        reject(err);
                    } else {
                        resilve(JSON.parse(data));
                    }
                });
            });
        };

        var getData = function (key) {
            var keyPath = path.join(storagePath, key);
            return accessFile(keyPath, fs.R_OK).then(function () {
                return readFile(keyPath);
            }, function (e) {
                if (e.code !== 'ENOENT') {
                    debug('Read accessFile error!', e);
                } else {
                    return undefined;
                }
            });
        };

        return inStack(key, function () {
            return getData(key).catch(function (e) {
                debug("Read storage error %s", key, e);
            });
        });
    };

    var writeKey = function (key, value) {
        var writeFile = function (keyPath, value) {
            return new Promise(function (resilve, reject) {
                fs.writeFile(keyPath, JSON.stringify(value), {
                    encoding: 'utf8'
                }, function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resilve();
                    }
                });
            });
        };

        var writeData = function (key, value) {
            var keyPath = path.join(storagePath, key);
            return accessFile(keyPath, fs.W_OK).catch(function (e) {
                if (e.code !== 'ENOENT') {
                    debug('Write accessFile error!', e);
                    throw e;
                }
            }).then(function () {
                return writeFile(keyPath, value);
            });
        };

        return inStack(key, function () {
            return writeData(key, value).catch(function (e) {
                debug("Write storage error %s", key, e);
            });
        });
    };

    var removeKey = function (key) {
        var removeFile = function (keyPath) {
            return new Promise(function (resilve, reject) {
                fs.unlink(keyPath, function (err) {
                    if (err) {
                        reject(err);
                    } else {
                        resilve();
                    }
                });
            });
        };

        var removeData = function (key) {
            var keyPath = path.join(storagePath, key);
            return accessFile(keyPath, fs.F_OK).then(function () {
                return removeFile(keyPath);
            }, function (e) {
                if (e.code !== 'ENOENT') {
                    debug('Remove accessFile error!', e);
                }
            });
        };

        return inStack(key, function () {
            return removeData(key).catch(function (e) {
                debug("Remove storage error %s", key, e);
            });
        });
    };

    this.get = function(keys) {
        var items = {};
        var defaultItems = {};

        var _keys = [];
        if (Array.isArray(keys)) {
            _keys = keys;
        } else
        if (typeof keys === 'object') {
            _keys = Object.keys(keys);
            defaultItems = keys;
        } else {
            _keys = [keys];
        }

        var promiseList = _keys.map(function (key) {
            return readKey(key, defaultItems[key]).then(function (value) {
                if (value === undefined) {
                    value = defaultItems[key];
                }
                if (value !== undefined) {
                    items[key] = value;
                }
            });
        });

        return Promise.all(promiseList).then(function () {
            return items;
        });
    };
    this.set = function(items) {
        var promiseList = Object.keys(items).map(function (key) {
            if (items[key] !== undefined) {
                return writeKey(key, items[key]);
            } else {
                return Promise.resolve();
            }
        });

        return Promise.all(promiseList);
    };
    this.remove = function(keys) {
        var _keys = [];
        if (Array.isArray(keys)) {
            _keys = keys;
        } else {
            _keys = [keys];
        }

        var promiseList = _keys.map(function (key) {
            return removeKey(key);
        });

        return Promise.all(promiseList);
    };
};

module.exports = Storage;