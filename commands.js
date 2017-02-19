/**
 * Created by anton on 06.12.15.
 */
"use strict";
var Promise = require('bluebird');
var debug = require('debug')('app:commands');
var base = require('./base');
var CustomError = require('./customError').CustomError;

var menuBtnList = function (page) {
    var btnList = null;
    if (page === 1) {
        btnList = [
            [
                {
                    text: 'Options',
                    callback_data: '/options'
                }
            ],
            [
                {
                    text: '<',
                    callback_data: '/menu_page 0'
                },
                {
                    text: 'Top 10',
                    callback_data: '/top'
                },
                {
                    text: 'About',
                    callback_data: '/about'
                }
            ]
        ];
    } else {
        btnList = [
            [
                {
                    text: 'Show the channel list',
                    callback_data: '/list'
                }
            ],
            [
                {
                    text: 'Add channel',
                    callback_data: '/add'
                },
                {
                    text: 'Delete channel',
                    callback_data: '/delete'
                },
                {
                    text: '>',
                    callback_data: '/menu_page 1'
                }
            ]
        ];
    }

    return btnList;
};

var optionsBtnList = function (chatItem) {
    var options = chatItem.options || {};

    var btnList = [];

    if (options.hidePreview) {
        btnList.push([{
            text: 'Show preview',
            callback_data: '/option hidePreview 0'
        }]);
    } else {
        btnList.push([{
            text: 'Hide preview',
            callback_data: '/option hidePreview 1'
        }]);
    }

    if (options.channel) {
        btnList.push([{
            text: 'Remove channel (' + options.channel + ')',
            callback_data: '/setchannel remove'
        }]);
    } else {
        btnList.push([{
            text: 'Set channel',
            callback_data: '/setchannel'
        }]);
    }

    if (options.channel) {
        if (options.mute) {
            btnList.push([{
                text: 'Unmute',
                callback_data: '/option mute 0'
            }]);
        } else {
            btnList.push([{
                text: 'Mute',
                callback_data: '/option mute 1'
            }]);
        }
    }

    return btnList;
};

/**
 * @param {Object} chatItem
 * @param {number} page
 * @param {Object|Array} mediumBtn
 * @returns {Array.<*>}
 */
var getDeleteChannelList = function (chatItem, page, mediumBtn) {
    var _this = this;
    var btnList = [];
    var oneServiceMode = _this.gOptions.serviceList.length === 1;

    Object.keys(chatItem.serviceList).forEach(function (service) {
        var channelList = chatItem.serviceList[service];
        channelList.forEach(function(channelName) {
            var btnItem = {};

            // todo: rollback getChannelLocalTitle
            // var title = base.getChannelLocalTitle(_this.gOptions, service, channelName);
            var title = channelName;
            if (!oneServiceMode) {
                title += ' (' + _this.gOptions.serviceToTitle[service] + ')';
            }
            btnItem.text = title;

            btnItem.callback_data = '/d "' + channelName + '" "' + service + '"';

            btnList.push([btnItem]);
        });
    });

    return base.pageBtnList(btnList, 'delete_upd', page, mediumBtn);
};

var setOption = function (chatItem, optionName, state) {
    if (['hidePreview', 'mute'].indexOf(optionName) === -1) {
        debug('Option is not found! %s', optionName);
        return Promise.reject(new Error('Option is not found!'));
    }

    var options = base.getObjectItem(chatItem, 'options', {});
    options[optionName] = state === '1';
    if (!options[optionName]) {
        delete options[optionName];
    }

    if (!Object.keys(options).length) {
        delete chatItem.options;
    }

    var msgText = 'Option ' + optionName + ' (' + state + ') changed!';

    return Promise.resolve(msgText);
};

var commands = {
    ping: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(chatId, "pong");
    },
    start: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.help, {
            reply_markup: JSON.stringify({
                inline_keyboard: menuBtnList(0)
            })
        });
    },
    menu_page__Cb: function (callbackQuery, page) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        page = parseInt(page);

        return _this.gOptions.bot.editMessageReplyMarkup(
            chatId,
            {
                message_id: msg.message_id,
                reply_markup: JSON.stringify({
                    inline_keyboard: menuBtnList(page)
                })
            }
        );
    },
    help: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        var text = _this.gOptions.language.help;
        if (base.getRandomInt(0, 100) < 30) {
            text += _this.gOptions.language.rateMe;
        }

        return _this.gOptions.bot.sendMessage(chatId, text, {
            disable_web_page_preview: true,
            reply_markup: JSON.stringify({
                inline_keyboard: menuBtnList(0)
            })
        });
    },
    a: function (msg, channelName, service) {
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;

        return _this.gOptions.services[service].getChannelId(channelName).then(function (channelName) {
            var chatItem = chatList[chatId] = chatList[chatId] || {};
            chatItem.chatId = chatId;

            var serviceList = chatItem.serviceList = chatItem.serviceList || {};
            var channelList = serviceList[service] = serviceList[service] || [];

            if (channelList.indexOf(channelName) !== -1) {
                return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.channelExists);
            }

            channelList.push(channelName);

            // todo: rollback channel local title
            // var title = base.getChannelLocalTitle(_this.gOptions, service, channelName);
            var title = channelName;
            var url = base.getChannelUrl(service, channelName);

            var displayName = base.htmlSanitize('a', title, url);

            if (service === 'youtube') {
                _this.gOptions.events.emit('subscribe', channelName);
            }

            return base.storage.set({chatList: chatList}).then(function () {
                return _this.gOptions.bot.sendMessage(
                    chatId,
                    _this.gOptions.language.channelAdded
                        .replace('{channelName}', displayName)
                        .replace('{serviceName}', base.htmlSanitize(_this.gOptions.serviceToTitle[service])),
                    {
                        disable_web_page_preview: true,
                        parse_mode: 'HTML'
                    }
                );
            });
        }).catch(function(err) {
            if (!err instanceof CustomError) {
                debug('Channel %s (%s) is not found!', channelName, service, err);
            }
            return _this.gOptions.bot.sendMessage(
                chatId,
                _this.gOptions.language.channelIsNotFound
                    .replace('{channelName}', channelName)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service])
            );
        });
    },
    add: function (msg, channelName, serviceName) {
        var _this = this;
        var chatId = msg.chat.id;

        var data = [];

        var oneServiceMode = _this.gOptions.serviceList.length === 1;
        if (oneServiceMode && channelName) {
            data.push.apply(data, arguments);
            data.shift();
            channelName = data.join(' ');
            serviceName = null;
            data.splice(0);
        }

        var readUrl = function(url) {
            var channelName = null;
            for (var service in _this.gOptions.serviceMatchRe) {
                var reList = _this.gOptions.serviceMatchRe[service];
                if (!Array.isArray(reList)) {
                    reList = [reList];
                }
                reList.some(function(re) {
                    if (re.test(url)) {
                        channelName = url.match(re)[1];
                        return true;
                    }
                });
                if (channelName) {
                    break;
                }
            }
            return channelName && {
                channel: channelName,
                service: service
            };
        };

        if (channelName) {
            var info = readUrl(channelName);
            if (info) {
                data.push('"'+ info.channel + '"');
                data.push('"' + info.service + '"');
            } else {
                data.push('"'+ channelName + '"');
                serviceName && data.push('"' + serviceName + '"');
            }
        }

        var onTimeout = function(onMessage) {
            msg.text = '/cancel add';
            if (onMessage.messageId) {
                msg.text += ' ' + onMessage.messageId;
            }
            return _this.onMessage(msg);
        };

        var waitChannelName = function() {
            var onMessage = _this.stateList[chatId] = function(msg, text) {
                var info = readUrl(text);
                if (info) {
                    data.push('"' + info.channel + '"');
                    data.push('"' + info.service + '"');
                } else {
                    data.push('"' + text + '"');
                }

                msg.text = '/a ' + data.join(' ');
                return _this.onMessage(msg);
            };
            onMessage.command = 'add';
            onMessage.userId = msg.from.id;
            onMessage.timeout = setTimeout(function() {
                return onTimeout(onMessage);
            }, 3 * 60 * 1000);

            var options = null;
            var msgText = _this.gOptions.language.enterChannelName;
            if (chatId < 0) {
                msgText += _this.gOptions.language.groupNote;
                options = {
                    reply_markup: JSON.stringify({
                        force_reply: true
                    })
                };
            }
            
            return _this.gOptions.bot.sendMessage(chatId, msgText, options).then(function (msg) {
                if (chatId > 0) {
                    onMessage.messageId = msg.message_id;
                }
            });
        };

        if (data.length === 0) {
            return waitChannelName();
        } else {
            msg.text = '/a ' + data.join(' ');
            return _this.onMessage(msg);
        }
    },
    d__Cb: function (callbackQuery, channelName, service) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        var channelList = chatItem && chatItem.serviceList && chatItem.serviceList[service];

        if (!channelList) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        var pos = channelList.indexOf(channelName);
        if (pos === -1) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.channelDontExist,
                {
                    message_id: msg.message_id
                }
            );
        }

        channelList.splice(pos, 1);

        if (channelList.length === 0) {
            delete chatItem.serviceList[service];

            if (Object.keys(chatItem.serviceList).length === 0) {
                delete chatList[chatId];
            }
        }

        return base.storage.set({chatList: chatList}).then(function () {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.channelDeleted
                    .replace('{channelName}', channelName)
                    .replace('{serviceName}', _this.gOptions.serviceToTitle[service]),
                {
                    message_id: msg.message_id
                }
            );
        });
    },
    delete_upd__Cb: function (callbackQuery, page) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        var mediumBtn = {
            text: 'Cancel',
            callback_data: '/c "delete"'
        };

        var btnList = getDeleteChannelList.call(_this, chatItem, page, mediumBtn);

        return _this.gOptions.bot.editMessageReplyMarkup(chatId, {
            message_id: msg.message_id,
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        });
    },
    delete: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var msgText = _this.gOptions.language.selectDelChannel;

        var mediumBtn = {
            text: 'Cancel',
            callback_data: '/c "delete"'
        };

        var btnList = getDeleteChannelList.call(_this, chatItem, 0, mediumBtn);

        return _this.gOptions.bot.sendMessage(chatId, msgText, {
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        });
    },
    option: function (msg, optionName, state) {
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        return setOption(chatItem, optionName, state).then(function (msgText) {
            return base.storage.set({chatList: chatList}).then(function () {
                return _this.gOptions.bot.sendMessage(chatId, msgText);
            });
        });
    },
    option__Cb: function (callbackQuery, optionName, state) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        return setOption(chatItem, optionName, state).then(function (msgText) {
            return base.storage.set({chatList: chatList}).then(function () {
                return _this.gOptions.bot.editMessageReplyMarkup(chatId, {
                    message_id: msg.message_id,
                    reply_markup: JSON.stringify({
                        inline_keyboard: optionsBtnList(chatItem)
                    })
                });
            });
        });
    },
    options: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        return _this.gOptions.bot.sendMessage(chatId, 'Options:', {
            reply_markup: JSON.stringify({
                inline_keyboard: optionsBtnList(chatItem)
            })
        });
    },
    c__Cb: function (callbackQuery, command) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;

        return _this.gOptions.bot.editMessageText(
            chatId,
            _this.gOptions.language.commandCanceled
                .replace('{command}', command || ''),
            {
                message_id: msg.message_id
            }
        );
    },
    cancel: function (msg, arg1, messageId) {
        var _this = this;
        var chatId = msg.chat.id;
        var promise = null;

        var text = _this.gOptions.language.commandCanceled.replace('{command}', arg1 || '');

        if (messageId) {
            messageId = parseInt(messageId);
            promise = _this.gOptions.bot.editMessageText(
                chatId,
                text,
                {
                    message_id: messageId
                }
            );
        } else {
            promise = _this.gOptions.bot.sendMessage(
                chatId,
                text
            );
        }
        return promise;
    },
    clear: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var btnList = [[{
            text: 'Yes',
            callback_data: '/clearyes'
        }, {
            text: 'No',
            callback_data: '/c "clear"'
        }]];

        return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.clearSure, {
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        });
    },
    clearyes__Cb: function(callbackQuery) {
        var _this = this;
        var msg = callbackQuery.message;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.emptyServiceList,
                {
                    message_id: msg.message_id
                }
            );
        }

        delete _this.gOptions.storage.chatList[chatId];

        return base.storage.set({chatList: _this.gOptions.storage.chatList}).then(function () {
            return _this.gOptions.bot.editMessageText(
                chatId,
                _this.gOptions.language.cleared,
                {
                    message_id: msg.message_id
                }
            );
        });
    },
    list: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;
        var chatItem = _this.gOptions.storage.chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var serviceList = [];

        for (var service in chatItem.serviceList) {
            var channelList = chatItem.serviceList[service].map(function(channelName) {
                var url = base.getChannelUrl(service, channelName);
                if (!url) {
                    debug('URL is empty!');
                    return base.htmlSanitize(channelName);
                }

                // todo: rollback channel local title
                // var title = base.getChannelLocalTitle(_this.gOptions, service, channelName);
                var title = channelName;

                return base.htmlSanitize('a', title, url);
            });
            serviceList.push(base.htmlSanitize('b', _this.gOptions.serviceToTitle[service]) + ':\n' + channelList.join('\n'));
        }

        return _this.gOptions.bot.sendMessage(
            chatId, serviceList.join('\n\n'), {
                disable_web_page_preview: true,
                parse_mode: 'HTML'
            }
        );
    },
    setchannel: function (msg, channelName) {
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;
        var chatItem = chatList[chatId];

        if (!chatItem) {
            return _this.gOptions.bot.sendMessage(chatId, _this.gOptions.language.emptyServiceList);
        }

        var onTimeout = function(onMessage) {
            msg.text = '/cancel setchannel';
            if (onMessage.messageId) {
                msg.text += ' ' + onMessage.messageId;
            }
            return _this.onMessage(msg);
        };

        var onGetChannelName = function (msg, channelName) {
            channelName = channelName.trim();
            return Promise.try(function () {
                var options = base.getObjectItem(chatItem, 'options', {});

                if (channelName === 'remove') {
                    delete options.channel;
                    delete options.mute;

                    if (!Object.keys(options).length) {
                        delete chatItem.options;
                    }
                } else {
                    if (!/^@\w+$/.test(channelName)) {
                        throw new Error('BAD_FORMAT');
                    }

                    var exists = Object.keys(chatList).some(function (chatId) {
                        var item = chatList[chatId];
                        var options = item.options;

                        if (options && options.channel === channelName) {
                            return true;
                        }
                    });

                    if (exists) {
                        throw new Error('CHANNEL_EXISTS');
                    }

                    return _this.gOptions.bot.sendChatAction(channelName, 'typing').then(function () {
                        options.channel = channelName;
                    });
                }
            }).catch(function (err) {
                var msgText = _this.gOptions.language.telegramChannelError;
                msgText = msgText.replace('{channelName}', channelName);
                if (err.message === 'BAD_FORMAT') {
                    msgText += ' Channel name is incorrect.';
                } else
                if (err.message === 'CHANNEL_EXISTS') {
                    msgText += ' The channel has already been added.';
                } else
                if (/bot is not a member of the (?:channel|supergroup) chat/.test(err.message)) {
                    msgText += ' Bot must be admin in this channel.';
                } else
                if (/chat not found/.test(err.message)) {
                    msgText += ' Telegram chat is not found!';
                } else {
                    debug('Set channel %s error!', channelName, err);
                }

                return _this.gOptions.bot.sendMessage(chatId, msgText).then(function () {
                    throw new CustomError('SET_CHANNEL_ERROR');
                });
            }).then(function () {
                return base.storage.set({chatList: chatList}).then(function () {
                    return _this.gOptions.bot.sendMessage(chatId, 'Options:', {
                        reply_markup: JSON.stringify({
                            inline_keyboard: optionsBtnList(chatItem)
                        })
                    });
                });
            }).catch(function (err) {
                if (err.message !== 'SET_CHANNEL_ERROR') {
                    throw err;
                }
            });
        };

        var waitTelegramChannelName = function() {
            var onMessage = _this.stateList[chatId] = function(msg, text) {
                msg.text = '/setchannel "' + text + '"';
                return _this.onMessage(msg);
            };
            onMessage.command = 'setchannel';
            onMessage.userId = msg.from.id;
            onMessage.timeout = setTimeout(function() {
                return onTimeout(onMessage);
            }, 3 * 60 * 1000);

            var options = null;
            var msgText = _this.gOptions.language.telegramChannelEnter;
            if (chatId < 0) {
                msgText += _this.gOptions.language.groupNote;
                options = {
                    reply_markup: JSON.stringify({
                        force_reply: true
                    })
                };
            }

            return _this.gOptions.bot.sendMessage(chatId, msgText, options).then(function (msg) {
                if (chatId > 0) {
                    onMessage.messageId = msg.message_id;
                }
            });
        };

        if (channelName) {
            return onGetChannelName(msg, channelName);
        } else {
            return waitTelegramChannelName();
        }
    },
    top: function (msg) {
        var service, channelList, channelName;
        var _this = this;
        var chatId = msg.chat.id;
        var chatList = _this.gOptions.storage.chatList;

        var userCount = 0;
        var channelCount = 0;

        var top = {};
        for (var _chatId in chatList) {
            var chatItem = chatList[_chatId];
            if (!chatItem.serviceList) {
                continue;
            }

            userCount++;

            for (var n = 0; service = _this.gOptions.serviceList[n]; n++) {
                var userChannelList = chatItem.serviceList[service];
                if (!userChannelList) {
                    continue;
                }

                channelList = top[service];
                if (channelList === undefined) {
                    channelList = top[service] = {};
                }

                for (var i = 0; channelName = userChannelList[i]; i++) {
                    if (channelList[channelName] === undefined) {
                        channelList[channelName] = 0;
                    }
                    channelList[channelName]++;
                }
            }
        }

        var topArr = {};
        for (service in top) {
            channelList = top[service];

            channelCount += Object.keys(channelList).length;

            if (!topArr[service]) {
                topArr[service] = [];
            }

            for (channelName in channelList) {
                var count = channelList[channelName];
                topArr[service].push([channelName, count]);
            }
        }

        var textArr = [];

        textArr.push(_this.gOptions.language.users.replace('{count}', userCount));
        textArr.push(_this.gOptions.language.channels.replace('{count}', channelCount));

        for (service in topArr) {
            textArr.push('');
            textArr.push(_this.gOptions.serviceToTitle[service] + ':');
            topArr[service].sort(function (a, b) {
                return a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1
            }).splice(10);
            topArr[service].forEach(function (item, index) {
                var title = base.getChannelTitle(_this.gOptions, service, item[0]);

                textArr.push((index + 1) + '. ' + title);
            });
        }

        return _this.gOptions.bot.sendMessage(chatId, textArr.join('\n'), {
            disable_web_page_preview: true
        });
    },
    about: function (msg) {
        var _this = this;
        var chatId = msg.chat.id;

        return Promise.try(function() {
            var liveTime = JSON.parse(require("fs").readFileSync('./liveTime.json', 'utf8'));

            var endTime = liveTime.endTime.split(',');
            endTime = (new Date(endTime[0], endTime[1], endTime[2])).getTime();
            var count = parseInt((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;

            var message = liveTime.message.join('\n').replace('{count}', count);

            message += _this.gOptions.language.rateMe;

            return _this.gOptions.bot.sendMessage(chatId, message);
        });
    },
    refreshTitle: function(msg) {
        var _this = this;
        var chatId = msg.chat.id;
        var services = _this.gOptions.services;

        var queue = Promise.resolve();

        var serviceChannelList = _this.gOptions.checker.getChannelList();
        for (var service in serviceChannelList) {
            if (!serviceChannelList.hasOwnProperty(service)) {
                continue;
            }

            if (!services[service]) {
                debug('Service %s is not found!', service);
                continue;
            }

            var channelList = JSON.parse(JSON.stringify(serviceChannelList[service]));
            while (channelList.length) {
                var arr = channelList.splice(0, 100);
                (function(service, arr) {
                    queue = queue.finally(function() {
                        var promiseList = arr.map(function(userId) {
                            return services[service].getChannelId(userId);
                        });
                        return Promise.all(promiseList);
                    });
                })(service, arr);
            }
        }

        return queue.finally(function() {
            return _this.gOptions.bot.sendMessage(chatId, 'Done!');
        });
    },
    checkUserAlive: function(msg) {
        var _this = this;
        var chatId = msg.chat.id;

        var queue = Promise.resolve();

        var chatList = _this.gOptions.storage.chatList;
        for (var _chatId in chatList) {
            var chatItem = chatList[_chatId];
            (function(chatId) {
                queue = queue.finally(function () {
                    return _this.gOptions.bot.sendChatAction(chatId, 'typing').catch(function (err) {
                        debug('Send chat action error! %s', chatId, err);
                        _this.gOptions.msgSender.onSendMsgError(err, chatId);
                    });
                });
            })(chatItem.chatId);
        }

        return queue.finally(function() {
            return _this.gOptions.bot.sendMessage(chatId, 'Done!');
        });
    }
};

commands.stop = commands.clear;

module.exports = commands;