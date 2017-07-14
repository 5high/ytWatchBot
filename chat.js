/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:chat');
const base = require('./base');
const Router = require('./router');
const CustomError = require('./customError').CustomError;
const querystring = require('querystring');

var Chat = function(options) {
    var _this = this;
    var bot = options.bot;
    this.gOptions = options;

    var language = options.language;
    var events = options.events;
    var services = options.services;
    var serviceToTitle = options.serviceToTitle;
    var users = options.users;
    var router = new Router(options);

    var textOrCb = router.custom(['text', 'callback_query']);

    router.message(function (req, next) {
        var chatId = req.getChatId();
        var message = req.message;
        var promise = Promise.resolve();
        if (message.migrate_from_chat_id) {
            promise = promise.then(function () {
                return users.changeChatId(message.migrate_from_chat_id, chatId);
            })
        }
        if (message.migrate_to_chat_id) {
            promise = promise.then(function () {
                return users.changeChatId(chatId, message.migrate_to_chat_id);
            });
        }
        promise.then(next);
    });

    router.callback_query(function (req, next) {
        var id = req.callback_query.id;
        bot.answerCallbackQuery(id).then(next).catch(function (err) {
            debug('answerCallbackQuery error! %o', err);
        });
    });

    textOrCb(/(.+)/, function (req, next) {
        next();
        if (req.message) {
            var entities = req.getEntities();
            var commands = entities.bot_command || [];
            commands.forEach(function (entity) {
                var command = entity.value;
                var m = /([^@]+)/.exec(command);
                if (m) {
                    command = m[1];
                }
                _this.gOptions.tracker.track(req.message.chat.id, 'command', command, req.message.text);
            });
        } else
        if (req.callback_query) {
            var message = req.callback_query.data;
            var command = '';
            var m = /(\/[^?\s]+)/.exec(message);
            if (m) {
                command = m[1];
            }
            var msg = JSON.parse(JSON.stringify(req.callback_query.message));
            msg.text = message;
            msg.from = req.callback_query.from;
            _this.gOptions.tracker.track(msg.chat.id, 'command', command, msg.text);
        }
    });

    router.text(/\/ping/, function (req) {
        var chatId = req.getChatId();
        bot.sendMessage(chatId, "pong").catch(function (err) {
            debug('Command ping error! %o', err);
        });
    });

    textOrCb(/\/(start|menu|help)/, function (req) {
        var chatId = req.getChatId();

        if (req.message) {
            var help = language.help;
            if (req.params[0] === 'help') {
                if (base.getRandomInt(0, 100) < 30) {
                    help += language.rateMe;
                }
            }
            bot.sendMessage(chatId, help, {
                disable_web_page_preview: true,
                reply_markup: JSON.stringify({
                    inline_keyboard: menuBtnList(0)
                })
            }).catch(function (err) {
                debug('Command start error! %o', err);
            });
        } else
        if (req.callback_query) {
            var messageId = req.getMessageId();
            var query = req.getQuery();
            bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: menuBtnList(query.page)
            }), {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                if (/message is not modified/.test(err.message)) {
                    return;
                }
                debug('CallbackQuery start error! %o', err);
            });
        }
    });

    textOrCb(/\/top/, function (req) {
        var chatId = req.getChatId();

        return users.getAllChatChannels().then(function (items) {
            var users = [];
            var channels = [];
            var services = [];

            var serviceObjMap = {};
            items.forEach(function (item) {
                var chatId = item.chatId;
                if (users.indexOf(chatId) === -1) {
                    users.push(chatId);
                }

                var service = serviceObjMap[item.service];
                if (!service) {
                    service = serviceObjMap[item.service] = {
                        name: item.service,
                        count: 0,
                        channels: [],
                        channelObjMap: {}
                    };
                    services.push(service);
                }

                var channelId = item.id;
                var channel = service.channelObjMap[channelId];
                if (!channel) {
                    channel = service.channelObjMap[channelId] = {
                        id: channelId,
                        title: item.title,
                        url: item.url,
                        count: 0
                    };
                    service.count++;
                    service.channels.push(channel);
                    channels.push(channel);
                }
                channel.count++;
            });
            serviceObjMap = null;

            var sortFn = function (aa, bb) {
                var a = aa.count;
                var b = bb.count;
                return a === b ? 0 : a > b ? -1 : 1;
            };

            services.sort(sortFn);

            services.forEach(function (service) {
                delete service.channelObjMap;

                service.channels.sort(sortFn).splice(10);
            });

            return {
                users: users,
                channels: channels,
                services: services
            };
        }).then(function (info) {
            var textArr = [];

            textArr.push(language.users.replace('{count}', info.users.length));
            textArr.push(language.channels.replace('{count}', info.channels.length));

            info.services.forEach(function (service) {
                textArr.push('');
                textArr.push(serviceToTitle[service.name] + ':');
                service.channels.forEach(function (channel, index) {
                    textArr.push((index + 1) + '. ' + channel.title);
                });
            });

            return bot.sendMessage(chatId, textArr.join('\n'), {
                disable_web_page_preview: true
            });
        }).catch(function (err) {
            debug('Command top error! %o', err);
        });
    });

    textOrCb(/\/about/, function (req) {
        var chatId = req.getChatId();

        var liveTime = {
            endTime: '1970-01-01',
            message: [
                '{count}'
            ]
        };

        try {
            liveTime = JSON.parse(require("fs").readFileSync('./liveTime.json', 'utf8'));
        } catch (err) {
            debug('Load liveTime.json error! %o', err);
        }

        var count = '';
        var endTime = /(\d{4}).(\d{2}).(\d{2})/.exec(liveTime.endTime);
        if (endTime) {
            endTime = (new Date(endTime[1], endTime[2], endTime[3])).getTime();
            count = parseInt((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;
        }

        var message = liveTime.message;
        if (Array.isArray(message)) {
            message = message.join('\n');
        }

        message = message.replace('{count}', count);

        message += language.rateMe;

        return bot.sendMessage(chatId, message).catch(function (err) {
            debug('Command about error! %o', err);
        });
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        Promise.all([
            users.getChat(chatId).then(function (chat) {
                req.chat = chat;
            }),
            users.getChannels(chatId).then(function (channels) {
                req.channels = channels;
            })
        ]).then(next).catch(function (err) {
            debug('Get chat, channels error! %o', err);
        });
    });

    textOrCb(/\/add(?:\s+(.+$))?/, function (req) {
        var chatId = req.getChatId();
        var channel = req.params[0];

        var onResponse = function (channelName, messageId) {
            var serviceName = 'youtube';
            return addChannel(req, serviceName, channelName).then(function (/*dbChannel*/channel) {
                var url = channel.url;
                var displayName = base.htmlSanitize('a', channel.title, url);

                var result = language.channelAdded
                    .replace('{channelName}', displayName)
                    .replace('{serviceName}', base.htmlSanitize(serviceToTitle[serviceName]));

                return editOrSendNewMessage(chatId, messageId, result, {
                    disable_web_page_preview: true,
                    parse_mode: 'HTML'
                });
            }, function (err) {
                var result;
                if (err.message === 'CHANNEL_EXISTS') {
                    result = language.channelExists;
                } else {
                    result = language.channelIsNotFound.replace('{channelName}', channelName);
                }

                return editOrSendNewMessage(chatId, messageId, result, {
                    disable_web_page_preview: true
                });
            });
        };

        if (channel) {
            onResponse(channel).catch(function (err) {
                debug('Command add error! %o', err);
            });
            return;
        }

        var options = {};
        var msgText = language.enterChannelName;
        if (chatId < 0) {
            msgText += language.groupNote;
            options.reply_markup = JSON.stringify({
                force_reply: true
            });
        }

        _this.gOptions.bot.sendMessage(chatId, msgText, options).then(function (msg) {
            return router.waitResponse({
                event: 'message',
                type: 'text',
                chatId: chatId,
                fromId: req.getFromId(),
                throwOnCommand: true
            }, 3 * 60).then(function (req) {
                _this.gOptions.tracker.track(req.message.chat.id, 'command', '/add', req.message.text);
                return onResponse(req.message.text, msg.message_id);
            }, function () {
                var cancelText = language.commandCanceled.replace('{command}', 'add');
                return editOrSendNewMessage(chatId, msg.message_id, cancelText);
            });
        }).catch(function (err) {
            debug('Command add error! %o', err);
        });
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        if (!req.chat) {
            bot.sendMessage(chatId, language.emptyServiceList).catch(function (err) {
                debug('Check chat error! %o', err);
            });
        } else {
            next();
        }
    });

    textOrCb(/\/clear/, function (req) {
        var chatId = req.chat.id;
        var messageId = req.getMessageId();
        var query = req.getQuery();

        if (query.clear === 'true') {
            users.removeChat(chatId, 'By user').then(function () {
                return bot.editMessageText(language.cleared, {
                    chat_id: chatId,
                    message_id: messageId
                });
            }).catch(function (err) {
                debug('Command clear error! %o', err);
            });
            return;
        }

        if (query.cancel) {
            bot.editMessageText(language.commandCanceled.replace('{command}', 'clear'), {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                debug('Command clear error! %o', err);
            });
            return;
        }

        var btnList = [[{
            text: 'Yes',
            callback_data: '/clear?clear=true'
        }, {
            text: 'No',
            callback_data: '/clear?cancel=true'
        }]];

        return bot.sendMessage(chatId, language.clearSure, {
            reply_markup: JSON.stringify({
                inline_keyboard: btnList
            })
        }).catch(function (err) {
            debug('Command clear error! %o', err);
        });
    });

    textOrCb(/\/.+/, function (req, next) {
        var chatId = req.getChatId();
        if (!req.channels.length) {
            bot.sendMessage(chatId, language.emptyServiceList).catch(function (err) {
                debug('Check channel list error! %o', err);
            });
        } else {
            next();
        }
    });

    textOrCb(/\/delete/, function (req) {
        var chatId = req.getChatId();
        var query = req.getQuery();
        var messageId = req.getMessageId();
        var channels = req.channels;

        if (query.cancel) {
            var cancelText = language.commandCanceled.replace('{command}', 'delete');
            bot.editMessageText(cancelText, {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                debug('Command delete error! %o', err);
            });
            return;
        }

        if (query.channelId) {
            deleteChannel(req, query.channelId).then(function (result) {
                if (req.callback_query) {
                    return bot.editMessageText(result, {
                        chat_id: chatId,
                        message_id: messageId
                    });
                } else {
                    return bot.sendMessage(chatId, result);
                }
            }).catch(function (err) {
                debug('deleteChannel error! %o', err);
            });
            return;
        }

        var page = query.page || 0;
        var mediumBtn = {
            text: 'Cancel',
            callback_data: '/delete?cancel=true'
        };

        var btnList = [];
        var promise = Promise.resolve();
        channels.forEach(function(item) {
            var btnItem = {
                text: item.title,
                callback_data: '/delete?' + querystring.stringify({
                    channelId: item.id
                })
            };
            btnList.push([btnItem]);
        });

        return promise.then(function () {
            var pageBtnList = base.pageBtnList(btnList, '/delete', page, mediumBtn);

            if (req.callback_query && !query.rel) {
                return bot.editMessageReplyMarkup(JSON.stringify({
                    inline_keyboard: pageBtnList
                }), {
                    chat_id: chatId,
                    message_id: messageId
                }).catch(function (err) {
                    if (/message is not modified/.test(err.message)) {
                        return;
                    }
                    throw err;
                });
            } else {
                return bot.sendMessage(chatId, language.selectDelChannel, {
                    reply_markup: JSON.stringify({
                        inline_keyboard: pageBtnList
                    })
                });
            }
        }).catch(function (err) {
            debug('Command delete error! %o', err);
        });
    });

    textOrCb(/\/options/, function (req) {
        var chatId = req.chat.id;
        var messageId = req.getMessageId();
        var query = req.getQuery();

        var promise = Promise.resolve();
        if (query.key) {
            promise = promise.then(function () {
                return setOption(req.chat, query.key, query.value);
            });
        }

        promise.then(function () {
            if (req.callback_query && !query.rel) {
                return bot.editMessageReplyMarkup(JSON.stringify({
                    inline_keyboard: optionsBtnList(req.chat)
                }), {
                    chat_id: chatId,
                    message_id: messageId
                });
            } else {
                return bot.sendMessage(chatId, 'Options:', {
                    reply_markup: JSON.stringify({
                        inline_keyboard: optionsBtnList(req.chat)
                    })
                });
            }
        }).catch(function (err) {
            debug('Command options error! %o', err);
        });
    });

    textOrCb(/\/setChannel/, function (req) {
        var chatId = req.chat.id;
        var messageId = req.getMessageId();
        var query = req.getQuery();

        var updateOptionsMessage = function () {
            return req.callback_query && bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: optionsBtnList(req.chat)
            }), {
                chat_id: chatId,
                message_id: messageId
            }).catch(function (err) {
                if (/message is not modified/.test(err.message)) {
                    return;
                }
                throw err;
            });
        };

        if (query.remove) {
            delete req.chat.channelId;
            users.setChat(req.chat).then(function () {
                return updateOptionsMessage();
            }).catch(function (err) {
                debug('Command setChannel error! %o', err);
            });
            return;
        }

        var options = {};
        var msgText = language.telegramChannelEnter;
        if (chatId < 0) {
            msgText += language.groupNote;
            options.reply_markup = JSON.stringify({
                force_reply: true
            });
        }

        return bot.sendMessage(chatId, msgText, options).then(function (msg) {
            return router.waitResponse({
                event: 'message',
                type: 'text',
                chatId: chatId,
                fromId: req.getFromId(),
                throwOnCommand: true
            }, 3 * 60).then(function (_req) {
                _this.gOptions.tracker.track(_req.message.chat.id, 'command', '/setChannel', _req.message.text);
                return setChannel(req, _req.message.text).then(function (result) {
                    return editOrSendNewMessage(chatId, msg.message_id, result).then(function () {
                        return updateOptionsMessage();
                    });
                });
            }, function () {
                var cancelText = language.commandCanceled.replace('{command}', 'setChannel');
                return editOrSendNewMessage(chatId, msg.message_id, cancelText);
            });
        }).catch(function (err) {
            debug('setChannel error %o', err);
        });
    });

    textOrCb(/\/list/, function (req) {
        var chatId = req.chat.id;
        var channels = req.channels;

        var services = [];

        var serviceObjMap = {};
        channels.forEach(function (item) {
            var service = serviceObjMap[item.service];
            if (!service) {
                service = serviceObjMap[item.service] = {
                    name: item.service,
                    count: 0,
                    channels: [],
                    channelObjMap: {}
                };
                services.push(service);
            }

            var channelId = item.id;
            var channel = service.channelObjMap[channelId];
            if (!channel) {
                channel = service.channelObjMap[channelId] = {
                    id: channelId,
                    title: item.title,
                    url: item.url
                };
                service.count++;
                service.channels.push(channel);
            }
        });
        serviceObjMap = null;

        var sortFn = function (aa, bb) {
            var a = aa.count;
            var b = bb.count;
            return a === b ? 0 : a > b ? -1 : 1;
        };

        services.sort(sortFn);

        services.forEach(function (service) {
            delete service.channelObjMap;
        });

        return Promise.resolve(services).then(function (services) {
            if (!services.length) {
                return bot.sendMessage(chatId, language.emptyServiceList);
            }

            var serviceList = [];
            services.forEach(function (service) {
                var channelList = [];
                channelList.push(base.htmlSanitize('b', serviceToTitle[service.name]) + ':');
                service.channels.forEach(function (channel) {
                    channelList.push(base.htmlSanitize('a', channel.title, channel.url));
                });
                serviceList.push(channelList.join('\n'));
            });

            return bot.sendMessage(chatId, serviceList.join('\n\n'), {
                disable_web_page_preview: true,
                parse_mode: 'HTML'
            });
        }).catch(function (err) {
            debug('Command list error! %o', err);
        });
    });

    /*textOrCb(/\/refreshChannelInfo/, function (req) {
        var _this = this;
        var chatId = req.getChatId();

        var pool = new base.Pool(30);
        return users.getAllChannels().then(function (channels) {
            return pool.do(function () {
                var item = channels.shift();
                if (!item) return;

                var service = services[item.service];
                return service.getChannelId(item.id).catch(function (err) {
                    debug('refreshChannelInfo %s', item.id, err);
                });
            });
        }).then(function() {
            return bot.sendMessage(chatId, 'Done!');
        });
    });*/

    textOrCb(/\/cleanYoutubeChannels/, function (req) {
        const chatId = req.chat.id;
        const adminIds = _this.gOptions.config.adminIds || [];
        if (adminIds.indexOf(chatId) === -1) {
            return bot.sendMessage(chatId, 'Deny');
        }

        return _this.gOptions.users.getAllChannels().then(function (channels) {
            return channels.filter(function (channel) {
                return channel.service === 'youtube';
            });
        }).then(function (channels) {
            let promise = Promise.resolve();
            channels.forEach(function (channel) {
                promise = promise.then(function () {
                    return _this.gOptions.services.youtube.channelExists(channel).catch(function (err) {
                        if (!(err instanceof CustomError)) {
                            debug('getChannelId error! %s %o', channel.id, err);
                            return;
                        }

                        debug('Channel error! %s %o', channel.id, err);
                        return _this.gOptions.channels.removeChannel(channel.id);
                    });
                });
            });
            return promise;
        }).then(function () {
            return bot.sendMessage(chatId, 'Success');
        }).catch(function (err) {
            debug('Command cleanYoutubeChannels error! %o', err);
        });
    });

    /**
     * @param {Number|String} chatId
     * @param {Number} messageId
     * @param {String} text
     * @param {{}} [details]
     */
    var editOrSendNewMessage = function (chatId, messageId, text, details) {
        details = details || {};

        var sendMessage = function () {
            return bot.sendMessage(chatId, text, details);
        };

        var editMessage = function () {
            var _details = {};
            for (var key in details) {
                _details[key] = details[key];
            }
            _details.chat_id = chatId;
            _details.message_id = messageId;
            return bot.editMessageText(text, _details).catch(function (err) {
                if (/message can't be edited/.test(err.message) ||
                    /message to edit not found/.test(err.message)
                ) {
                    return sendMessage();
                }
                throw err;
            });
        };

        if (messageId) {
            return editMessage();
        } else {
            return sendMessage();
        }
    };

    var setChannel = function (req, channelId) {
        var chat = req.chat;
        return Promise.resolve().then(function () {
            channelId = channelId.trim();

            if (!/^@\w+$/.test(channelId)) {
                throw new Error('BAD_FORMAT');
            }

            return users.getChatByChannelId(channelId).then(function (channelChat) {
                if (channelChat) {
                    throw new Error('CHANNEL_EXISTS');
                }

                return bot.sendChatAction(channelId, 'typing').then(function () {
                    chat.options.mute = false;
                    chat.channelId = channelId;
                });
            }).then(function () {
                return users.setChat(chat);
            }).then(function () {
                return language.telegramChannelSet.replace('{channelName}', channelId);
            });
        }).catch(function (err) {
            var msgText = language.telegramChannelError.replace('{channelName}', channelId);
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
                debug('setChannel %s error! %o', channelId, err);
            }
            return msgText;
        });
    };

    var setOption = function (chat, key, value) {
        ['hidePreview', 'mute'].forEach(function (option) {
            if (option === key) {
                chat.options[option] = value === 'true';
                if (!chat.options[option]) {
                    delete chat.options[option];
                }
            }
        });

        return users.setChat(chat);
    };

    /**
     * @param {Object} req
     * @param {String} channelId
     * @return {Promise.<String>}
     */
    var deleteChannel = function (req, channelId) {
        var channel = null;
        req.channels.some(function (item) {
            if (item.id === channelId) {
                channel = item;
                return true;
            }
        });

        if (!channel) {
            return Promise.resolve(language.channelDontExist);
        }

        return _this.gOptions.users.removeChannel(req.chat.id, channel.id).then(function () {
            return _this.gOptions.users.getChannels(req.chat.id).then(function (channels) {
                if (channels.length === 0) {
                    return _this.gOptions.users.removeChat(req.chat.id, 'Empty channels');
                }
            });
        }).then(function () {
            return _this.gOptions.language.channelDeleted.replace('{channelName}', channel.title);
        });
    };


    var addChannel = function (req, serviceName, channelName) {
        var chatId = req.getChatId();
        return services[serviceName].getChannelId(channelName).then(function (channel) {
            var channelId = channel.id;
            // var title = channel.title;

            var found = req.channels.some(function (item) {
                return item.id === channelId;
            });

            if (found) {
                throw new CustomError('CHANNEL_EXISTS');
            }


            return users.getChat(chatId).then(function (chat) {
                if (!chat) {
                    return users.setChat({id: chatId});
                }
            }).then(function () {
                return users.addChannel(chatId, channelId);
            }).then(function () {
                if (serviceName === 'youtube') {
                    events.emit('subscribe2', [channel]);
                }

                return channel;
            });
        }).catch(function(err) {
            if (!(err instanceof CustomError)) {
                debug('addChannel %s error! %o', channelName, err);
            } else
            if (err.message !== 'CHANNEL_EXISTS') {
                debug('Channel is not found! %s %o', channelName, err);
            }
            throw err;
        });
    };

    var menuBtnList = function (page) {
        var btnList = null;
        if (page > 0) {
            btnList = [
                [
                    {
                        text: 'Options',
                        callback_data: '/options?rel=menu'
                    }
                ],
                [
                    {
                        text: '<',
                        callback_data: '/menu?page=0'
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
                        callback_data: '/delete?rel=menu'
                    },
                    {
                        text: '>',
                        callback_data: '/menu?page=1'
                    }
                ]
            ];
        }

        return btnList;
    };

    var optionsBtnList = function (chat) {
        var options = chat.options;

        var btnList = [];

        if (options.hidePreview) {
            btnList.push([{
                text: 'Show preview',
                callback_data: '/options?' + querystring.stringify({
                    key: 'hidePreview',
                    value: false
                })
            }]);
        } else {
            btnList.push([{
                text: 'Hide preview',
                callback_data: '/options?' + querystring.stringify({
                    key: 'hidePreview',
                    value: true
                })
            }]);
        }

        if (chat.channelId) {
            btnList.push([{
                text: 'Remove channel (' + chat.channelId + ')',
                callback_data: '/setChannel?' +  querystring.stringify({
                    remove: true
                })
            }]);
        } else {
            btnList.push([{
                text: 'Set channel',
                callback_data: '/setChannel'
            }]);
        }

        if (chat.channelId) {
            if (options.mute) {
                btnList.push([{
                    text: 'Unmute',
                    callback_data: '/options?' + querystring.stringify({
                        key: 'mute',
                        value: false
                    })
                }]);
            } else {
                btnList.push([{
                    text: 'Mute',
                    callback_data: '/options?' + querystring.stringify({
                        key: 'mute',
                        value: true
                    })
                }]);
            }
        }

        return btnList;
    };
};


module.exports = Chat;