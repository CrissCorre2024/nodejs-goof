const express = require('express');
const path = require('path');
const validator = require('validator');
const mongoose = require('mongoose');
const Todo = mongoose.model('Todo');
const User = mongoose.model('User');

var utils = require('../utils');
var hms = require('humanize-ms');
var ms = require('ms');
var streamBuffers = require('stream-buffers');
var readline = require('readline');
var moment = require('moment');
var exec = require('child_process').exec;
var fileType = require('file-type');
var AdmZip = require('adm-zip');
var fs = require('fs');
var _ = require('lodash');

// Lista de rutas permitidas para redirección
const allowedPaths = ['/admin', '/profile', '/dashboard'];

function validateRedirectPage(redirectPage) {
  return allowedPaths.includes(redirectPage);
}

exports.index = function (req, res, next) {
  Todo.find({})
    .sort('-updated_at')
    .exec(function (err, todos) {
      if (err) return next(err);

      res.render('index', {
        title: 'Patch TODO List',
        subhead: 'Vulnerabilities at their best',
        todos: todos,
      });
    });
};

exports.loginHandler = function (req, res, next) {
  if (validator.isEmail(req.body.username)) {
    // Cambia find por findOne para evitar inyecciones NoSQL
    User.findOne({ username: req.body.username, password: req.body.password }, function (err, user) {
      if (err) return next(err);
      if (user) {
        const redirectPage = req.body.redirectPage;
        const session = req.session;
        const username = req.body.username;
        return adminLoginSuccess(redirectPage, session, username, res);
      } else {
        return res.status(401).send();
      }
    });
  } else {
    return res.status(401).send();
  }
};

function adminLoginSuccess(redirectPage, session, username, res) {
  session.loggedIn = 1;

  // Log the login action for audit
  console.log(`User logged in: ${username}`);

  if (redirectPage && validateRedirectPage(redirectPage)) {
    return res.redirect(redirectPage);
  } else {
    return res.redirect('/admin');
  }
}

exports.login = function (req, res, next) {
  return res.render('admin', {
    title: 'Admin Access',
    granted: false,
    redirectPage: req.query.redirectPage
  });
};

exports.admin = function (req, res, next) {
  return res.render('admin', {
    title: 'Admin Access Granted',
    granted: true,
  });
};

exports.get_account_details = function(req, res, next) {
  const profile = {}
  return res.render('account.hbs', profile)
}

exports.save_account_details = function(req, res, next) {
  const profile = req.body
  if (validator.isEmail(profile.email, { allow_display_name: true })
    && validator.isMobilePhone(profile.phone, 'he-IL')
    && validator.isAscii(profile.firstname)
    && validator.isAscii(profile.lastname)
    && validator.isAscii(profile.country)
  ) {
    profile.firstname = validator.rtrim(profile.firstname)
    profile.lastname = validator.rtrim(profile.lastname)
    return res.render('account.hbs', profile)
  } else {
    console.log('error in form details')
    return res.render('account.hbs')
  }
}

exports.isLoggedIn = function (req, res, next) {
  if (req.session.loggedIn === 1) {
    return next()
  } else {
    return res.redirect('/')
  }
}

exports.logout = function (req, res, next) {
  req.session.loggedIn = 0
  req.session.destroy(function() { 
    return res.redirect('/')  
  })
}

function parse(todo) {
  var t = todo;

  var remindToken = ' in ';
  var reminder = t.toString().indexOf(remindToken);
  if (reminder > 0) {
    var time = t.slice(reminder + remindToken.length);
    time = time.replace(/\n$/, '');

    var period = hms(time);

    console.log('period: ' + period);

    t = t.slice(0, reminder);
    if (typeof period != 'undefined') {
      t += ' [' + ms(period) + ']';
    }
  }
  return t;
}

exports.create = function (req, res, next) {
  var item = req.body.content;
  var imgRegex = /\!\[alt text\]\((http.*)\s\".*/;
  if (typeof (item) == 'string' && item.match(imgRegex)) {
    var url = item.match(imgRegex)[1];
    console.log('found img: ' + url);

    exec('identify ' + url, function (err, stdout, stderr) {
      console.log(err);
      if (err !== null) {
        console.log('Error (' + err + '):' + stderr);
      }
    });

  } else {
    item = parse(item);
  }

  new Todo({
    content: item,
    updated_at: Date.now(),
  }).save(function (err, todo, count) {
    if (err) return next(err);

    res.setHeader('Location', '/');
    res.status(302).send(todo.content.toString('base64'));
  });
};

exports.destroy = function (req, res, next) {
  Todo.findById(req.params.id, function (err, todo) {
    if (err) return next(err);
    if (todo) {
      todo.remove(function (err) {
        if (err) return next(err);
        res.redirect('/');
      });
    } else {
      res.status(404).send('Not found');
    }
  });
};

exports.edit = function (req, res, next) {
  Todo.find({})
    .sort('-updated_at')
    .exec(function (err, todos) {
      if (err) return next(err);

      res.render('edit', {
        title: 'TODO',
        todos: todos,
        current: req.params.id
      });
    });
};

exports.update = function (req, res, next) {
  Todo.findById(req.params.id, function (err, todo) {
    if (err) return next(err);
    if (todo) {
      todo.content = req.body.content;
      todo.updated_at = Date.now();
      todo.save(function (err) {
        if (err) return next(err);
        res.redirect('/');
      });
    } else {
      res.status(404).send('Not found');
    }
  });
};

exports.current_user = function (req, res, next) {
  next();
};

function isBlank(str) {
  return (!str || /^\s*$/.test(str));
}

exports.import = function (req, res, next) {
  if (!req.files) {
    res.send('No files were uploaded.');
    return;
  }

  var importFile = req.files.importFile;
  var data;
  var importedFileType = fileType(importFile.data);
  var zipFileExt = { ext: "zip", mime: "application/zip" };
  if (importedFileType === null) {
    importedFileType = { ext: "txt", mime: "text/plain" };
  }
  if (importedFileType["mime"] === zipFileExt["mime"]) {
    var zip = new AdmZip(importFile.data);
    var extracted_path = "/tmp/extracted_files";
    zip.extractAllTo(extracted_path, true);
    data = "No backup.txt file found";
    fs.readFile('backup.txt', 'ascii', function (err, data) {
      if (!err) {
        data = data;
      }
    });
  } else {
    data = importFile.data.toString('ascii');
  }
  var lines = data.split('\n');
  lines.forEach(function (line) {
    var parts = line.split(',');
    var what = parts[0];
    console.log('importing ' + what);
    var when = parts[1];
    var locale = parts[2];
    var format = parts[3];
    var item = what;
    if (!isBlank(what)) {
      if (!isBlank(when) && !isBlank(locale) && !isBlank(format)) {
        console.log('setting locale ' + parts[1]);
        moment.locale(locale);
        var d = moment(when);
        console.log('formatting ' + d);
        item += ' [' + d.format(format) + ']';
      }

      new Todo({
        content: item,
        updated_at: Date.now(),
      }).save(function (err, todo, count) {
        if (err) return next(err);
        console.log('added ' + todo);
      });
    }
  });

  res.redirect('/');
};

exports.about_new = function (req, res, next) {
  console.log(JSON.stringify(req.query));
  return res.render("about_new.dust",
    {
      title: 'Patch TODO List',
      subhead: 'Vulnerabilities at their best',
      device: req.query.device
    });
};

// Prototype Pollution
const users = [
  { name: 'user', password: 'pwd' },
  { name: 'admin', password: Math.random().toString(32), canDelete: true },
];

let messages = [];
let lastId = 1;

function findUser(auth) {
  return users.find((u) =>
    u.name === auth.name &&
    u.password === auth.password
  )
}

exports.login_json = function (req, res, next) {
  const auth = req.body;
  const user = findUser(auth);
  if (user) {
    res.send(_.omit(user, 'password'));
  } else {
    res.status(401).send('Invalid credentials');
  }
};

exports.messages = function (req, res, next) {
  const auth = req.body;
  const user = findUser(auth);
  if (user) {
    res.send(messages);
  } else {
    res.status(401).send('Invalid credentials');
  }
};

exports.message = function (req, res, next) {
  const auth = req.body.auth;
  const user = findUser(auth);
  if (user) {
    const message = { user, text: req.body.text, id: lastId++ };
    messages.push(message);
    res.send(message);
  } else {
    res.status(401).send('Invalid credentials');
  }
};

exports.delete_message = function (req, res, next) {
  const auth = req.body.auth;
  const user = findUser(auth);
  if (user && user.canDelete) {
    messages = messages.filter((msg) => msg.id != req.body.id);
    res.send(messages);
  } else {
    res.status(401).send('Unauthorized');
  }
};

exports.print_message = function (req, res, next) {
  const id = req.query.id;
  const message = messages.find((msg) => msg.id == id);
  if (message) {
    const buffer = new streamBuffers.WritableStreamBuffer({
      initialSize: 100 * 1024,
      incrementAmount: 10 * 1024,
    });

    const rl = readline.createInterface({
      input: fs.createReadStream(message.user.name),
      output: buffer,
    });

    rl.on('line', (line) => {
      console.log(line);
    });

    rl.on('close', () => {
      res.send(buffer.getContentsAsString('utf8'));
    });
  } else {
    res.status(404).send('Message not found');
  }
};
