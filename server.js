#!/bin/env node
var express = require('express');
var fs      = require('fs');
var mysql   = require('mysql');
var cors    = require('cors');
var request = require('request');
var cheerio = require('cheerio');

/**
 *  BB Wikia Voter app
 */
var BBWikiVoter = function() {

    //  Scope.
    var self = this;


    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port      = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
        };
    };

    /**
     *  Populate the cache.
     */
    self.populateCache = function() {
        if (typeof self.zcache === "undefined") {
            self.zcache = { 'index.html': '' };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./index.html');
    };

    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function(key) { return self.zcache[key]; };

    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating app ...',
                       Date(Date.now()), sig);
           process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };

    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() { self.terminator(element); });
        });
    };

    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
        self.routes = { };

        // self.routes['/'] = function(req, res) {
        //     res.setHeader('Content-Type', 'text/html');
        //     res.send(self.cache_get('index.html') );
        // };

        // self.routes['/vote/'] = function(req, res) {
        //     res.send("POST only!");
        // };
    };

    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.createRoutes();
        self.app = express();

        self.app.use(express.bodyParser());

        self.app.use(cors());
        self.app.options('*', cors());

        //  Add handlers for the app (from the routes).
        // for (var r in self.routes) {
        //     self.app.get(r, self.routes[r]);
        // }

        self.app.post('/vote/', cors(), function (req, res, next) {
            // do the upsert here
            try {
                if (!req.body) {
                    res.status(400).json({"result": "error", "reason": "Invalid request"});
                    return;
                }

                var voter = req.body.voter,
                familiar = req.body.familiar,
                score = req.body.score;

                if (!voter || !familiar || !score) {
                    res.status(400).json({"result": "error", "reason": "Invalid parameters"});
                    return;
                }

                var connection = mysql.createConnection({
                    host     : process.env.OPENSHIFT_MYSQL_DB_HOST,
                    user     : process.env.OPENSHIFT_MYSQL_DB_USERNAME,
                    password : process.env.OPENSHIFT_MYSQL_DB_PASSWORD,
                    port     : process.env.OPENSHIFT_MYSQL_DB_PORT,
                    database : 'bloodbrothers'
                });

                connection.connect();

                var query = "INSERT INTO votes(voter, score, familiar) values(?, ?, ?) " +
                        "ON DUPLICATE KEY UPDATE voter = VALUES(voter), score = VALUES(score), familiar = VALUES(familiar)";
                connection.query(query, [voter, score, familiar], function(err, rows, fields) {
                    if (err) throw err;
                    res.json({"result": "success"});
                });

                connection.end();
            }
            catch (err) {
                res.status(500).json({"result": "error"});
                throw err;
            }
        });

        self.app.post('/vote/multiple/', cors(), function (req, res, next) {
            // do the upsert here
            try {
                if (!req.body) {
                    res.status(400).json({"result": "error", "reason": "Invalid request"});
                    return;
                }

                var data = req.body.data;

                if (!data) {
                    res.status(400).json({"result": "error", "reason": "Invalid request"});
                    return;
                }

                var connection = mysql.createConnection({
                    host     : process.env.OPENSHIFT_MYSQL_DB_HOST,
                    user     : process.env.OPENSHIFT_MYSQL_DB_USERNAME,
                    password : process.env.OPENSHIFT_MYSQL_DB_PASSWORD,
                    port     : process.env.OPENSHIFT_MYSQL_DB_PORT,
                    database : 'bloodbrothers'
                });

                connection.connect();

                for (var i = 0; i < data.length; i++) {
                    var tmp = data[i];
                    var k = i; //closure
                    var voter = tmp.voter,
                        familiar = tmp.familiar,
                        score = tmp.score;

                    if (!voter || !familiar || !score) {
                        res.status(400).json({"result": "error", "reason": "Invalid parameters"});
                        return;
                    }

                    var query = "INSERT INTO votes(voter, score, familiar) values(?, ?, ?) " +
                            "ON DUPLICATE KEY UPDATE voter = VALUES(voter), score = VALUES(score), familiar = VALUES(familiar)";
                    connection.query(query, [voter, score, familiar], function(err, rows, fields) {
                        if (err) throw err;

                        if (k === data.length - 1) {
                            res.json({"result": "success"});
                        }
                    });
                }

                connection.end();
            }
            catch (err) {
                res.status(500).json({"result": "error"});
                throw err;
            }
        });

        self.app.post('/getVote/all/', cors(), function (req, res, next) {
            try {
                if (!req.body) {
                    res.status(400).json({"result": "error", "reason": "Invalid request"});
                    return;
                }

                var voter = req.body.voter;

                var connection = mysql.createConnection({
                    host     : process.env.OPENSHIFT_MYSQL_DB_HOST,
                    user     : process.env.OPENSHIFT_MYSQL_DB_USERNAME,
                    password : process.env.OPENSHIFT_MYSQL_DB_PASSWORD,
                    port     : process.env.OPENSHIFT_MYSQL_DB_PORT,
                    database : 'bloodbrothers'
                });

                connection.connect();

                var query = "select voter, t1.familiar, score, avg from (select familiar, avg(score) as avg from votes group by familiar) t1 " +
                    "left join (select voter, familiar, score from votes where voter = ?) t2 on t1.familiar = t2.familiar";
                connection.query(query, [voter], function(err, rows, fields) {
                    if (err) throw err;
                    res.json({
                        "result": "success",
                        "data": rows
                    });
                });

                connection.end();
            }
            catch (err) {
                res.status(500).json({"result": "error"});
                throw err;
            }
        });

        self.app.post('/getTier/', cors(), function (req, res, next) {
            request('http://bloodbrothersgame.wikia.com/index.php?action=render&title=Familiar_Tier_List/PvP', function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    console.log('Request succeeded.')
                    var $ = cheerio.load(body);

                    var dict = {};

                    $('.wikitable').each(function(i, elem) {
                        var tier = $(elem).attr('id').substr(5).replace(".2B", "+");
                        dict[tier] = [];
                        var rows = $(this).find('tr');
                        rows.each(function(j, row) {
                            if ($(row).find('td').length !== 0) {
                                var name = $($(row).find('td').get(2)).text().trim();
                                dict[tier].push(name);
                            }
                        });
                    });
                    res.json(dict);
                }
            });
        });
    };

    /**
     *  Initializes the application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.populateCache();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };

    /**
     *  Start the server
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, self.ipaddress, function() {
            console.log('%s: Node server started on %s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

};

/**
 *  main():  Main code.
 */
var zapp = new BBWikiVoter();
zapp.initialize();
zapp.start();
