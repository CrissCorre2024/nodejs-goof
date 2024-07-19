/**
 * Module dependencies.
 */

// mongoose setup
require('./mongoose-db');
require('./typeorm-db');

var st = require('st');
var express = require('express');
var path = require('path');
var ejsEngine = require('ejs-locals');
var bodyParser = require('body-parser');
var session = require('express-session');
var methodOverride = require('method-override');
var logger = require('morgan');
var errorHandler = require('errorhandler');
var marked = require('marked');
var fileUpload = require('express-fileupload');
var cons = require('consolidate');
const hbs = require('hbs');

var app = express();
var routes = require('./routes');
var routesUsers = require('./routes/users.js');

// all environments
app.set('port', process.env.PORT || 3001);
app.engine('ejs', ejsEngine);
app.engine('hbs', hbs.__express);
cons.dust.helpers = require('dustjs-helpers'); // Ensure you import helpers if using dust
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(methodOverride());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(fileUpload());

// Session configuration
const sessionSecret = process.env.SESSION_SECRET || 'default_secret';
app.use(session({
  secret: sessionSecret,
  name: 'connect.sid',
  cookie: { path: '/' }
}));

// Routes
app.use(routes.current_user);
app.get('/', routes.index);
app.get('/login', routes.login);
app.post('/login', routes.loginHandler);
app.get('/admin', routes.isLoggedIn, routes.admin);
app.get('/account_details', routes.isLoggedIn, routes.get_account_details);
app.post('/account_details', routes.isLoggedIn, routes.save_account_details);
app.get('/logout', routes.logout);
app.post('/create', routes.create);
app.get('/destroy/:id', routes.destroy);
app.get('/edit/:id', routes.edit);
app.post('/update/:id', routes.update);
app.post('/import', routes.import);
app.get('/about_new', routes.about_new);
app.get('/chat', routes.chat.get);
app.put('/chat', routes.chat.add);
app.delete('/chat', routes.chat.delete);
app.use('/users', routesUsers);

// Static
app.use(st({ path: './public', url: '/public' }));

// Add the option to output (sanitized!) markdown
marked.setOptions({ sanitize: true });
app.locals.marked = marked;

// Error handling
if (app.get('env') === 'development') {
  app.use(errorHandler());
} else {
  // Implement a more robust error handler for production
  app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: {}
    });
  });
}

console.log('App running on port ' + app.get('port'));
