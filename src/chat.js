import Router from "./router";
import htmlSanitize from "./tools/htmlSanitize";
import ErrorWithCode from "./tools/errorWithCode";
import pageBtnList from "./tools/pageBtnList";
import splitTextByPages from "./tools/splitTextByPages";
import resolvePath from "./tools/resolvePath";

const debug = require('debug')('app:Chat');
const jsonStringifyPretty = require("json-stringify-pretty-compact");
const fs = require('fs');

class Chat {
  constructor(/**Main*/main) {
    this.main = main;

    this.router = new Router(main);

    /**@type {function(RegExp, ...function(RouterReq, RouterRes, function()))}*/
    this.router.textOrCallbackQuery = this.router.custom(['text', 'callback_query']);

    this.main.bot.on('message', (message) => {
      this.router.handle('message', message);
    });
    this.main.bot.on('callback_query', (message) => {
      this.router.handle('callback_query', message);
    });

    this.base();
    this.menu();
    this.user();
    this.admin();
  }

  base() {
    this.router.textOrCallbackQuery(/(.+)/, (req, res, next) => {
      next();
      if (req.message) {
        this.main.tracker.track(req.chatId, {
          ec: 'command',
          ea: req.command,
          el: req.message.text,
        });
      } else
      if (req.callback_query) {
        const data = req.callback_query.data;
        let command = '';
        let m = /(\/[^?\s]+)/.exec(data);
        if (m) {
          command = m[1];
        }
        const msg = Object.assign({}, req.callback_query.message, {
          text: data,
          from: req.callback_query.from
        });
        this.main.tracker.track(msg.chat.id, {
          ec: 'command',
          ea: command,
          el: msg.text,
        });
      }
    });

    this.router.callback_query((req, res, next) => {
      return this.main.bot.answerCallbackQuery(req.callback_query.id).then(next);
    });

    this.router.text(/\/ping/, (req, res) => {
      return this.main.bot.sendMessage(req.chatId, 'pong').catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });
  }

  menu() {
    this.router.text(/\/(start|menu|help)/, (req, res) => {
      const help = this.main.locale.getMessage('help');
      return this.main.bot.sendMessage(req.chatId, help, {
        disable_web_page_preview: true,
        reply_markup: JSON.stringify({
          inline_keyboard: getMenu(0)
        })
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/menu(?:\/(?<page>\d+))?/, (req, res) => {
      return this.main.bot.editMessageReplyMarkup(JSON.stringify({
        inline_keyboard: getMenu(parseInt(req.params.page || 0, 10))
      }), {
        chat_id: req.chatId,
        message_id: req.messageId
      }).catch((err) => {
        if (/message is not modified/.test(err.message)) {
          // pass
        } else {
          debug('%j error %o', req.command, err);
        }
      });
    });

    this.router.textOrCallbackQuery(/\/top/, (req, res) => {
      return this.main.db.getChatIdChannelId().then((chatIdChannelIdList) => {
        const serviceIds = [];
        const serviceIdCount = {};
        const chatIds = [];
        const channelIds = [];
        const serviceIdChannelIdCount = {};
        chatIdChannelIdList.forEach(({chatId, channelId, serviceId}) => {
          if (!serviceIds.includes(serviceId)) {
            serviceIds.push(serviceId);
          }

          if (!chatIds.includes(chatId)) {
            chatIds.push(chatId);
          }

          if (!channelIds.includes(channelId)) {
            channelIds.push(channelId);
          }

          if (!serviceIdCount[serviceId]) {
            serviceIdCount[serviceId] = 0;
          }

          let channelIdCount = serviceIdChannelIdCount[serviceId];
          if (!channelIdCount) {
            channelIdCount = serviceIdChannelIdCount[serviceId] = {};
          }

          if (!channelIdCount[channelId]) {
            channelIdCount[channelId] = 0;
            serviceIdCount[serviceId]++;
          }

          channelIdCount[channelId]++;
        });

        serviceIds.sort((aa, bb) => {
          const a = serviceIdCount[aa];
          const b = serviceIdCount[bb];
          return a === b ? 0 : a > b ? -1 : 1;
        });

        const topChannelIds = [];
        const serviceIdTop = {};
        serviceIds.forEach((serviceId) => {
          const channelIdCount = serviceIdChannelIdCount[serviceId];

          const top10 = Object.keys(channelIdCount).sort((aa, bb) => {
            const a = channelIdCount[aa];
            const b = channelIdCount[bb];
            return a === b ? 0 : a > b ? -1 : 1;
          }).slice(0, 10);

          serviceIdTop[serviceId] = top10;

          top10.forEach((channelId) => {
            topChannelIds.push(channelId);
          });
        });

        return this.main.db.getChannelsByIds(topChannelIds).then((channels) => {
          const channelIdChannelMap = channels.reduce((result, channel) => {
            result[channel.id] = channel;
            return result;
          }, {});

          return {
            chatIdsCount: chatIds.length,
            channelIdsCount: channelIds.length,
            serviceIds,
            serviceIdCount,
            serviceIdTop,
            channelIdChannelMap
          };
        });
      }).then(({chatIdsCount, channelIdsCount, serviceIds, serviceIdCount, serviceIdTop, channelIdChannelMap}) => {
        const lines = [];

        lines.push(this.main.locale.getMessage('users').replace('{count}', chatIdsCount));
        lines.push(this.main.locale.getMessage('channels').replace('{count}', channelIdsCount));

        serviceIds.forEach((serviceId) => {
          const name = this.main[serviceId].name;
          const count = serviceIdCount[serviceId];
          lines.push('');
          lines.push(`${name} (${count}):`);

          serviceIdTop[serviceId].forEach((channelId, index) => {
            const channel = channelIdChannelMap[channelId];
            lines.push((index + 1) + '. ' + channel.name);
          });
        });

        return this.main.bot.sendMessage(req.chatId, lines.join('\n'), {
          disable_web_page_preview: true
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    let liveTime = null;
    this.router.textOrCallbackQuery(/\/about/, (req, res) => {
      if (!liveTime) {
        try {
          liveTime = JSON.parse(fs.readFileSync('./liveTime.json', 'utf8'));
        } catch (err) {
          debug('Read liveTime.json error! %o', err);
          liveTime = {
            endTime: '1970-01-01',
            message: [
              '{count}'
            ]
          };
        }
        if (Array.isArray(liveTime.message)) {
          liveTime.message = liveTime.message.join('\n');
        }
      }

      let count = '';
      const m = /(\d{4}).(\d{2}).(\d{2})/.exec(liveTime.endTime);
      if (m) {
        const endTime = (new Date(m[1], m[2], m[3])).getTime();
        count = Math.trunc((endTime - Date.now()) / 1000 / 60 / 60 / 24 / 30 * 10) / 10;
      }

      const message = liveTime.message.replace('{count}', count);

      return this.main.bot.sendMessage(req.chatId, message).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });
  }

  user() {
    const provideChat = (req, res, next) => {
      return this.main.db.ensureChat(req.chatId).then((chat) => {
        req.chat = chat;
        next();
      }, (err) => {
        debug('ensureChat error! %o', err);
        this.main.bot.sendMessage(req.chatId, 'Oops something went wrong...');
      });
    };

    const provideChannels = (req, res, next) => {
      return this.main.db.getChannelsByChatId(req.chatId).then((channels) => {
        req.channels = channels;
        next();
      }, (err) => {
        debug('ensureChannels error! %o', err);
        this.main.bot.sendMessage(req.chatId, 'Oops something went wrong...');
      });
    };

    const withChannels = (req, res, next) => {
      if (req.channels.length) {
        next();
      } else {
        this.main.bot.sendMessage(req.chatId, this.main.locale.getMessage('emptyServiceList'));
      }
    };

    this.router.callback_query(/\/cancel\/(?<command>[^\s]+)/, (req, res) => {
      const command = req.params.command;

      const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', command);
      return this.main.bot.editMessageText(cancelText, {
        chat_id: req.chatId,
        message_id: req.messageId
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/add(?:\s+(?<query>.+$))?/, provideChat, (req, res) => {
      const serviceId = 'youtube';
      const query = req.params.query;
      let requestedData = null;

      return Promise.resolve().then(() => {
        if (query) {
          return {query: query.trim()};
        }

        const messageText = this.main.locale.getMessage('enterChannelName');
        const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', 'add');
        return requestData(req.chatId, req.fromId, messageText, cancelText).then(({req, msg}) => {
          requestedData = req.message.text;
          this.main.tracker.track(req.chatId, 'command', '/add', req.message.text);
          return {query: req.message.text.trim(), messageId: msg.message_id};
        });
      }).then(({query, messageId}) => {
        const service = /**@type Youtube*/this.main[serviceId];
        return service.findChannel(query).then((rawChannel) => {
          return this.main.db.ensureChannel(serviceId, rawChannel).then((channel) => {
            return Promise.resolve().then(() => {
              if (req.chat.isNewRecord) {
                return req.chat.save();
              }
            }).then(() => {
              return this.main.db.putChatIdChannelId(req.chatId, channel.id).then((created) => {
                return {channel, created};
              });
            });
          });
        }).then(({channel, created}) => {
          let message = null;
          if (!created) {
            message = this.main.locale.getMessage('channelExists');
          } else {
            const {name, url} = channel;
            message = this.main.locale.getMessage('channelAdded')
              .replace('{channelName}', htmlSanitize('a', name, url))
              .replace('{serviceName}', service.name);
          }
          return editOrSendNewMessage(req.chatId, messageId, message, {
            disable_web_page_preview: true,
            parse_mode: 'HTML'
          });
        }, async (err) => {
          let isResolved = false;
          let message = null;
          if (['CHANNEL_BY_QUERY_IS_NOT_FOUND', 'CHANNEL_IS_NOT_FOUND'].includes(err.code)) {
            isResolved = true;
            message = this.main.locale.getMessage('channelIsNotFound').replace('{channelName}', query);
          } else
          if (err.message === 'CHANNELS_LIMIT') {
            isResolved = true;
            message = 'Channels limit exceeded';
          } else {
            message = 'Unexpected error';
          }
          await editOrSendNewMessage(req.chatId, messageId, message, {
            disable_web_page_preview: true
          });
          if (!isResolved) {
            throw err;
          }
        });
      }).catch((err) => {
        if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
          // pass
        } else {
          debug('%j %j error %o', req.command, requestedData, err);
        }
      });
    });

    this.router.callback_query(/\/clear\/confirmed/, (req, res) => {
      return this.main.db.deleteChatById(req.chatId).then(() => {
        debug(`Chat ${req.chatId} deleted by user`);
        return this.main.bot.editMessageText(this.main.locale.getMessage('cleared'), {
          chat_id: req.chatId,
          message_id: req.messageId
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/clear/, (req, res) => {
      return this.main.bot.sendMessage(req.chatId, this.main.locale.getMessage('clearSure'), {
        reply_markup: JSON.stringify({
          inline_keyboard: [[{
            text: 'Yes',
            callback_data: '/clear/confirmed'
          }, {
            text: 'No',
            callback_data: '/cancel/clear'
          }]]
        })
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/delete\/(?<channelId>.+)/, (req, res) => {
      const channelId = req.params.channelId;

      return this.main.db.getChannelById(channelId).then((channel) => {
        return this.main.db.deleteChatIdChannelId(req.chatId, channelId).then((count) => {
          return {channel, deleted: !!count};
        });
      }).then(({channel, deleted}) => {
        return this.main.bot.editMessageText(this.main.locale.getMessage('channelDeleted').replace('{channelName}', channel.name), {
          chat_id: req.chatId,
          message_id: req.messageId
        });
      }, async (err) => {
        let isResolved = false;
        let message = null;
        if (err.code === 'CHANNEL_IS_NOT_FOUND') {
          isResolved = true;
          message = this.main.locale.getMessage('channelDontExist');
        } else {
          message = 'Unexpected error';
        }
        await this.main.bot.editMessageText(message, {
          chat_id: req.chatId,
          message_id: req.messageId
        });
        if (!isResolved) {
          throw err;
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/delete/, provideChannels, withChannels, (req, res) => {
      const channels = req.channels.map((channel) => {
        return [{
          text: channel.name,
          callback_data: `/delete/${channel.id}`
        }];
      });

      const page = pageBtnList(req.query, channels, '/delete', {
        text: 'Cancel',
        callback_data: '/cancel/delete'
      });

      return Promise.resolve().then(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageReplyMarkup(JSON.stringify({
            inline_keyboard: page
          }), {
            chat_id: req.chatId,
            message_id: req.messageId
          }).catch((err) => {
            if (/message is not modified/.test(err.message)) {
              // pass
            } else {
              throw err;
            }
          });
        } else {
          return this.main.bot.sendMessage(req.chatId, this.main.locale.getMessage('selectDelChannel'), {
            reply_markup: JSON.stringify({
              inline_keyboard: page
            })
          });
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.callback_query(/\/deleteChannel/, provideChat, (req, res) => {
      return Promise.resolve().then(() => {
        return req.chat.update({
          isMuted: false,
          channelId: null,
        });
      }).then(() => {
        return this.main.bot.editMessageReplyMarkup(JSON.stringify({
          inline_keyboard: getOptions(req.chat)
        }), {
          chat_id: req.chatId,
          message_id: req.messageId
        }).catch((err) => {
          if (/message is not modified/.test(err.message)) {
            return;
          }
          throw err;
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/setChannel(?:\s+(?<channelId>.+))?/, provideChat, (req, res) => {
      const channelId = req.params.channelId;
      let requestedData = null;

      return Promise.resolve().then(() => {
        if (channelId) {
          return {channelId: channelId.trim()};
        }

        const messageText = this.main.locale.getMessage('telegramChannelEnter');
        const cancelText = this.main.locale.getMessage('commandCanceled').replace('{command}', '\/setChannel');
        return requestData(req.chatId, req.fromId, messageText, cancelText).then(({req, msg}) => {
          requestedData = req.message.text;
          this.main.tracker.track(req.chatId, 'command', '/setChannel', req.message.text);
          return {channelId: req.message.text.trim(), messageId: msg.message_id};
        });
      }).then(({channelId, messageId}) => {
        return Promise.resolve().then(() => {
          if (!/^@\w+$/.test(channelId)) {
            throw new ErrorWithCode('Incorrect channel name', 'INCORRECT_CHANNEL_NAME');
          }

          return this.main.db.getChatByChannelId(channelId).then((chat) => {
            throw new ErrorWithCode('Channel already used', 'CHANNEL_ALREADY_USED');
          }, (err) => {
            if (err.code === 'CHAT_IS_NOT_FOUND') {
              // pass
            } else {
              throw err;
            }
          }).then(() => {
            return this.main.bot.sendChatAction(channelId, 'typing').then(() => {
              return this.main.bot.getChat(channelId).then((chat) => {
                if (chat.type !== 'channel') {
                  throw new ErrorWithCode('This chat type is not supported', 'INCORRECT_CHAT_TYPE');
                }
                return req.chat.update({
                  isMuted: false,
                  channelId: '@' + chat.username,
                });
              });
            });
          });
        }).then(() => {
          const message = this.main.locale.getMessage('telegramChannelSet').replace('{channelName}', req.chat.channelId);
          return editOrSendNewMessage(req.chatId, messageId, message).then(() => {
            if (req.callback_query) {
              return this.main.bot.editMessageReplyMarkup(JSON.stringify({
                inline_keyboard: getOptions(req.chat)
              }), {
                chat_id: req.chatId,
                message_id: req.messageId
              }).catch((err) => {
                if (/message is not modified/.test(err.message)) {
                  return;
                }
                throw err;
              });
            }
          });
        }, async (err) => {
          let isResolved = false;
          let message = null;
          if (['INCORRECT_CHANNEL_NAME', 'CHANNEL_ALREADY_USED', 'INCORRECT_CHAT_TYPE'].includes(err.code)) {
            isResolved = true;
            message = err.message;
          } else {
            message = 'Unexpected error';
          }
          await editOrSendNewMessage(req.chatId, req.messageId, message);
          if (!isResolved) {
            throw err;
          }
        });
      }).catch((err) => {
        if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
          // pass
        } else {
          debug('%j %j error %o', req.command, requestedData, err);
        }
      });
    });

    this.router.callback_query(/\/options\/(?<key>[^\/]+)\/(?<value>.+)/, provideChat, (req, res) => {
      const {key, value} = req.params;
      return Promise.resolve().then(() => {
        const changes = {};
        switch (key) {
          case 'isHidePreview': {
            changes.isHidePreview = value === 'true';
            break;
          }
          case 'isMuted': {
            changes.isMuted = value === 'true';
            break;
          }
          default: {
            throw new Error('Unknown option filed');
          }
        }
        return req.chat.update(changes);
      }).then(() => {
        return this.main.bot.editMessageReplyMarkup(JSON.stringify({
          inline_keyboard: getOptions(req.chat)
        }), {
          chat_id: req.chatId,
          message_id: req.messageId
        }).catch((err) => {
          if (/message is not modified/.test(err.message)) {
            return;
          }
          throw err;
        });
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/options/, provideChat, (req, res) => {
      return Promise.resolve().then(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageReplyMarkup(JSON.stringify({
            inline_keyboard: getOptions(req.chat)
          }), {
            chat_id: req.chatId,
            message_id: req.messageId
          });
        } else {
          return this.main.bot.sendMessage(req.chatId, 'Options:', {
            reply_markup: JSON.stringify({
              inline_keyboard: getOptions(req.chat)
            })
          });
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/list/, provideChannels, withChannels, (req, res) => {
      const serviceIds = [];
      const serviceIdChannels = {};
      req.channels.forEach((channel) => {
        let serviceChannels = serviceIdChannels[channel.service];
        if (!serviceChannels) {
          serviceChannels = serviceIdChannels[channel.service] = [];
          serviceIds.push(channel.service);
        }
        serviceChannels.push(channel);
      });

      serviceIds.sort((aa, bb) => {
        const a = serviceIdChannels[aa].length;
        const b = serviceIdChannels[bb].length;
        return a === b ? 0 : a > b ? -1 : 1;
      });

      const lines = [];
      serviceIds.forEach((serviceId) => {
        const channelLines = [];
        channelLines.push(htmlSanitize('b', this.main[serviceId].name + ':'));
        serviceIdChannels[serviceId].forEach((channel) => {
          channelLines.push(htmlSanitize('a', channel.name, channel.url));
        });
        lines.push(channelLines.join('\n'));
      });

      const body = lines.join('\n\n');
      const pageIndex = parseInt(req.query.page || 0);
      const pages = splitTextByPages(body);
      const prevPages = pages.splice(0, pageIndex);
      const pageText = pages.shift() || prevPages.shift();

      const pageControls = [];
      if (pageIndex > 0) {
        pageControls.push({
          text: '<',
          callback_data: '/list' + '?page=' + (pageIndex - 1)
        });
      }
      if (pages.length) {
        pageControls.push({
          text: '>',
          callback_data: '/list' + '?page=' + (pageIndex + 1)
        });
      }

      const options = {
        disable_web_page_preview: true,
        parse_mode: 'HTML',
        reply_markup: JSON.stringify({
          inline_keyboard: [pageControls]
        })
      };

      return Promise.resolve().then(() => {
        if (req.callback_query && !req.query.rel) {
          return this.main.bot.editMessageText(pageText, Object.assign(options, {
            chat_id: req.chatId,
            message_id: req.messageId,
          }));
        } else {
          return this.main.bot.sendMessage(req.chatId, pageText, options);
        }
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    const requestData = (chatId, fromId, messageText, cancelText) => {
      const options = {};
      let msgText = messageText;
      if (chatId < 0) {
        msgText += this.main.locale.getMessage('groupNote');
        options.reply_markup = JSON.stringify({
          force_reply: true
        });
      }

      return this.main.bot.sendMessage(chatId, msgText, options).then((msg) => {
        return this.router.waitResponse({
          event: 'message',
          type: 'text',
          chatId: chatId,
          fromId: fromId,
          throwOnCommand: true
        }, 3 * 60).then(({req, res, next}) => {
          return {req, msg};
        }, async (err) => {
          if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
            await editOrSendNewMessage(chatId, msg.message_id, cancelText);
          }
          throw err;
        });
      });
    };

    const editOrSendNewMessage = (chatId, messageId, text, form) => {
      return Promise.resolve().then(() => {
        if (!messageId) {
          throw new ErrorWithCode('messageId is empty', 'MESSAGE_ID_IS_EMPTY');
        }

        return this.main.bot.editMessageText(text, Object.assign({}, form, {
          chat_id: chatId,
          message_id: messageId,
        }));
      }).catch((err) => {
        if (
          err.code === 'MESSAGE_ID_IS_EMPTY' ||
          /message can't be edited/.test(err.message) ||
          /message to edit not found/.test(err.message)
        ) {
          return this.main.bot.sendMessage(chatId, text, form);
        }
        throw err;
      });
    };
  }

  admin() {
    const isAdmin = (req, res, next) => {
      const adminIds = this.main.config.adminIds || [];
      if (adminIds.includes(req.chatId)) {
        next();
      } else {
        this.main.bot.sendMessage(req.chatId, `Access denied for you (${req.chatId})`);
      }
    };

    this.router.callback_query(/\/admin\/(?<command>.+)/, isAdmin, (req, res) => {
      const command = req.params.command;
      return Promise.resolve().then(() => {
        const {scope, endPoint} = resolvePath(this.main, command);
        return scope[endPoint].call(scope);
      }).then((result) => {
        const resultStr = jsonStringifyPretty({result}, {
          indent: 2
        });
        return this.main.bot.sendMessage(req.chatId, `${command} complete!\n${resultStr}`);
      }, async (err) => {
        await this.main.bot.sendMessage(req.chatId, `${command} error!`);
        throw err;
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });

    this.router.textOrCallbackQuery(/\/admin/, isAdmin, (req, res) => {
      return this.main.bot.sendMessage(req.chatId, 'Admin menu', {
        reply_markup: JSON.stringify({
          inline_keyboard: [
            [
              {
                text: 'checker.check',
                callback_data: '/admin/checker.check'
              },
              {
                text: 'checker.clean',
                callback_data: '/admin/checker.clean'
              },
            ],
            [
              {
                text: 'ytPubSub.updateSubscribes',
                callback_data: '/admin/ytPubSub.updateSubscribes'
              },
              {
                text: 'ytPubSub.clean',
                callback_data: '/admin/ytPubSub.clean'
              },
            ],
          ]
        })
      }).catch((err) => {
        debug('%j error %o', req.command, err);
      });
    });
  }
}

function getMenu(page) {
  let menu = null;
  if (page > 0) {
    menu = [
      [
        {
          text: 'Options',
          callback_data: '/options?rel=menu'
        }
      ],
      [
        {
          text: '<',
          callback_data: '/menu'
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
    menu = [
      [
        {
          text: 'Show the channel list',
          callback_data: '/list?rel=menu'
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
          callback_data: '/menu/1'
        }
      ]
    ];
  }

  return menu;
}

function getOptions(chat) {
  const btnList = [];

  if (chat.isHidePreview) {
    btnList.push([{
      text: 'Show preview',
      callback_data: '/options/isHidePreview/false'
    }]);
  } else {
    btnList.push([{
      text: 'Hide preview',
      callback_data: '/options/isHidePreview/true'
    }]);
  }

  if (chat.channelId) {
    btnList.push([{
      text: 'Remove channel (' + chat.channelId + ')',
      callback_data: '/deleteChannel',
    }]);
  } else {
    btnList.push([{
      text: 'Set channel',
      callback_data: '/setChannel',
    }]);
  }

  if (chat.channelId) {
    if (chat.isMuted) {
      btnList.push([{
        text: 'Unmute',
        callback_data: '/options/isMuted/false'
      }]);
    } else {
      btnList.push([{
        text: 'Mute',
        callback_data: '/options/isMuted/true'
      }]);
    }
  }

  return btnList;
}

export default Chat;