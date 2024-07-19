const utils = require('../utils');
const mongoose = require('mongoose');
const Todo = mongoose.model('Todo');
const User = mongoose.model('User');
const hms = require('humanize-ms');
const ms = require('ms');
const streamBuffers = require('stream-buffers');
const readline = require('readline');
const moment = require('moment');
const exec = require('child_process').exec;
const validator = require('validator');
const fileType = require('file-type');
const AdmZip = require('adm-zip');
const fs = require('fs');
const _ = require('lodash');

exports.index = (req, res, next) => {
  Todo.find({}).sort('-updated_at').exec((err, todos) => {
    if (err) return next(err);
    res.render('index', {
      title: 'Patch TODO List',
      subhead: 'Vulnerabilities at their best',
      todos,
    });
  });
};

exports.loginHandler = (req, res, next) => {
  const { username, password, redirectPage } = req.body;

  if (validator.isEmail(username)) {
    User.findOne({ username, password }, (err, user) => {
      if (err) return next(err);
      if (user) {
        adminLoginSuccess(redirectPage, req.session, username, res);
      } else {
        res.status(401).send();
      }
    });
  } else {
    res.status(401).send();
  }
};

function adminLoginSuccess(redirectPage, session, username, res) {
  session.loggedIn = 1;
  console.log(`User logged in: ${username}`);
  res.redirect(redirectPage || '/admin');
}

exports.login = (req, res, next) => {
  res.render('admin', {
    title: 'Admin Access',
    granted: false,
    redirectPage: req.query.redirectPage,
  });
};

exports.admin = (req, res, next) => {
  res.render('admin', {
    title: 'Admin Access Granted',
    granted: true,
  });
};

exports.get_account_details = (req, res, next) => {
  // Placeholder for getting user profile from the database
  const profile = {};
  res.render('account.hbs', profile);
};

exports.save_account_details = (req, res, next) => {
  const profile = req.body;

  if (validator.isEmail(profile.email, { allow_display_name: true }) &&
      validator.isMobilePhone(profile.phone, 'he-IL') &&
      validator.isAscii(profile.firstname) &&
      validator.isAscii(profile.lastname) &&
      validator.isAscii(profile.country)) {

    profile.firstname = validator.rtrim(profile.firstname);
    profile.lastname = validator.rtrim(profile.lastname);

    res.render('account.hbs', profile);
  } else {
    console.log('Error in form details');
    res.render('account.hbs');
  }
};

exports.isLoggedIn = (req, res, next) => {
  if (req.session.loggedIn === 1) {
    next();
  } else {
    res.redirect('/');
  }
};

exports.logout = (req, res, next) => {
  req.session.loggedIn = 0;
  req.session.destroy(() => res.redirect('/'));
};

function parse(todo) {
  const remindToken = ' in ';
  const reminderIndex = todo.indexOf(remindToken);
  
  if (reminderIndex > 0) {
    let time = todo.slice(reminderIndex + remindToken.length).trim();
    const period = hms(time);

    console.log('Period:', period);

    todo = todo.slice(0, reminderIndex);
    if (period) {
      todo += ` [${ms(period)}]`;
    }
  }
  
  return todo;
}

exports.create = (req, res, next) => {
  const item = req.body.content;
  const imgRegex = /\!\[alt text\]\((http.*)\s\".*/;

  if (typeof item === 'string' && imgRegex.test(item)) {
    const url = item.match(imgRegex)[1];
    console.log('Found img:', url);

    exec(`identify ${url}`, (err, stdout, stderr) => {
      if (err) {
        console.log('Error:', err, stderr);
      }
    });
  } else {
    req.body.content = parse(item);
  }

  new Todo({
    content: req.body.content,
    updated_at: Date.now(),
  }).save((err, todo) => {
    if (err) return next(err);
    res.status(302).redirect('/');
  });
};

exports.destroy = (req, res, next) => {
  Todo.findById(req.params.id, (err, todo) => {
    if (err) return next(err);
    if (todo) {
      todo.remove((err) => {
        if (err) return next(err);
        res.redirect('/');
      });
    } else {
      res.status(404).send('Not found');
    }
  });
};

exports.edit = (req, res, next) => {
  Todo.find({}).sort('-updated_at').exec((err, todos) => {
    if (err) return next(err);
    res.render('edit', {
      title: 'TODO',
      todos,
      current: req.params.id,
    });
  });
};

exports.update = (req, res, next) => {
  Todo.findById(req.params.id, (err, todo) => {
    if (err) return next(err);
    if (todo) {
      todo.content = req.body.content;
      todo.updated_at = Date.now();
      todo.save((err) => {
        if (err) return next(err);
        res.redirect('/');
      });
    } else {
      res.status(404).send('Not found');
    }
  });
};

exports.current_user = (req, res, next) => {
  next();
};

function isBlank(str) {
  return !str || /^\s*$/.test(str);
}

exports.import = (req, res, next) => {
  if (!req.files || !req.files.importFile) {
    res.send('No files were uploaded.');
    return;
  }

  const importFile = req.files.importFile;
  let data;
  const importedFileType = fileType(importFile.data) || { ext: 'txt', mime: 'text/plain' };

  if (importedFileType.mime === 'application/zip') {
    const zip = new AdmZip(importFile.data);
    const extractedPath = '/tmp/extracted_files';
    zip.extractAllTo(extractedPath, true);
    fs.readFile(`${extractedPath}/backup.txt`, 'ascii', (err, fileData) => {
      data = err ? 'No backup.txt file found' : fileData;
      processImportData(data, res);
    });
  } else {
    data = importFile.data.toString('ascii');
    processImportData(data, res);
  }
};

function processImportData(data, res) {
  const lines = data.split('\n');
  lines.forEach((line) => {
    const [what, when, locale, format] = line.split(',');
    if (!isBlank(what)) {
      let item = what;
      if (!isBlank(when) && !isBlank(locale) && !isBlank(format)) {
        moment.locale(locale);
        const d = moment(when);
        item += ` [${d.format(format)}]`;
      }
      new Todo({
        content: item,
        updated_at: Date.now(),
      }).save((err) => {
        if (err) console.log('Error adding todo:', err);
      });
    }
  });
  res.redirect('/');
}

exports.about_new = (req, res, next) => {
  console.log('Query:', JSON.stringify(req.query));
  res.render('about_new.dust', {
    title: 'Patch TODO List',
    subhead: 'Vulnerabilities at their best',
    device: req.query.device,
  });
};

// Prototype Pollution
const users = [
  { name: 'user', password: 'pwd' },
  { name: 'admin', password: Math.random().toString(32), canDelete: true },
];

const messages = [];
let lastId = 1;

function findUser(auth) {
  return users.find(u =>
    u.name === auth.name &&
    u.password === auth.password);
}

exports.chat = {
  get(req, res) {
    res.send(messages);
  },
  add(req, res) {
    const user = findUser(req.body.auth || {});
    if (!user) {
      res.status(403).send({ ok: false, error: 'Access denied' });
      return;
    }
    const message = {
      icon: '👋',
      ...req.body.message,
      id: lastId++,
      timestamp: Date.now(),
      userName: user.name,
    };
    messages.push(message);
    res.send({ ok: true });
  },
  delete(req, res) {
    const user = findUser(req.body.auth || {});
    if (!user || !user.canDelete) {
      res.status(403).send({ ok: false, error: 'Access denied' });
      return;
    }
    const messageId = req.body.messageId;
    messages = messages.filter(m => m.id !== messageId);
    res.send({ ok: true });
  },
};
