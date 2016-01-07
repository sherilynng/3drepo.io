/**
 *	Copyright (C) 2014 3D Repo Ltd
 *
 *	This program is free software: you can redistribute it and/or modify
 *	it under the terms of the GNU Affero General Public License as
 *	published by the Free Software Foundation, either version 3 of the
 *	License, or (at your option) any later version.
 *
 *	This program is distributed in the hope that it will be useful,
 *	but WITHOUT ANY WARRANTY; without even the implied warranty of
 *	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *	GNU Affero General Public License for more details.
 *
 *	You should have received a copy of the GNU Affero General Public License
 *	along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Inspired by
// http://stackoverflow.com/questions/12037655/node-js-mongodb-native-driver-connection-sharing

var config	  = require("./config.js");

var responseCodes = require("./response_codes.js");

var MongoClient = require("mongodb").MongoClient,
	Server      = require("mongodb").Server,
	Db          = require("mongodb").Db,
	GridStore   = require("mongodb").GridStore,
	Binary      = require("mongodb").Binary;

var C = require("./constants.js");
var systemLogger = require("./logger.js").systemLogger;

// Create connection to Mongo
// Main DB Object constructor
var MongoDBObject = function()
{
	"use strict";

	var self = this instanceof MongoDBObject ? this : Object.create(MongoDBObject.prototype);

	self.host = config.db.host;
	self.port = config.db.port;

	self.username = config.db.username;
	self.password = config.db.password;

	self.dbConns  = {};

	var authDBConn = new Db("admin", new Server(config.db.host, config.db.port,
		{
			auto_reconnect: true
		}),
	{ safe : false });

	authDBConn.open(function(err, dbConn) {
		if(err) {
			var dbError = responseCodes.DB_ERROR(err);
			systemLogger.logError(dbError);
			throw Error(dbError);
		}

		self.authDB = dbConn;
	});

	return self;
};

MongoDBObject.prototype.getURL = function(database)
{
	"use strict";

	return "mongodb://" + this.username + ":" + this.password + "@" + this.host + ":" + this.port + "/" + database + "?authSource=admin";
};

MongoDBObject.prototype.open = function(database, callback, forgetMe)
{
	"use strict";

	var self = this;

	forgetMe = (forgetMe === undefined) ? false : true;

	if (this.dbConns[database])
	{
		callback(null, this.dbConns[database]);
	} else {
		MongoClient.connect(this.getURL(database), function(err, db) {
			if (err) {
				return callback(err, null);
			}

			if (!forgetMe) {
				self.dbConns[database] = db;
			}

			callback(null, db);
		});
	}
};

MongoDBObject.prototype.authenticateUser = function(username, password, callback)
{
	"use strict";
	var self = this;

	self.authDB.admin().authenticate(username, password, function(err) {
		if(err) {
			return callback(responseCodes.DB_ERROR(err));
		}

		callback(responseCodes.OK);
	});
}

var mongo = new MongoDBObject();

var MongoWrapper = function(logger) {
	"use strict";

	var self = this instanceof MongoWrapper ? this : Object.create(MongoWrapper.prototype);

	self.logger = logger;

	return self;
};

/*******************************************************************************
 * Authenticate User against admin database
 *
 * @param {Error} err - err object
 * @param {string} username - username logging in
 * @param {string} password - corresponding password for username
 * @param {function} callback - has parameters (err, user) where
 *								user is the user object
 ******************************************************************************/
MongoWrapper.prototype.authenticateUser = function(username, password, callback) {
	"use strict";

	// Create a separate admin database connection to avoid
	// constantly switching between auth user and NodeJS
	// user

	var self = this;

	self.logger.logInfo("Authenticating user");
	mongo.authenticateUser(username, password, callback);
};

/*******************************************************************************
 * Open a database connection and pass it to the callback function
 *
 * @param {Error} err - err object
 * @param {string} dbName - Database name which to open
 * @param {function} callback - has parameters (err, dbConn) where
 *								dbConn is the returned database connection.
 ******************************************************************************/
MongoWrapper.prototype.dbCallback = function(dbName, callback) {
	"use strict";
    var self = this;
    mongo.open(dbName, function (err, db) {

        if (err) {
			return callback(responseCodes.DB_ERROR(err));
		}

		callback(responseCodes.OK, db);
	});
};

/*******************************************************************************
 * Run callbacks dependant on whether file exists or not
 *
 * @param {string} dbName     - Database name to get the file from
 * @param {string} collName   - Collection to get the file from
 * @param {string} fileName   - File name to retrieve
 * @param {function} callback - Callback function to run if file exists
 *
 ******************************************************************************/
MongoWrapper.prototype.existsGridFSFile = function(dbName, collName, fileName, callback)
{
	"use strict";
	var self = this;

	self.dbCallback(dbName, function (err, dbConn) {
		if (err.value) {
			return callback(err);
		}

		// Verify that the file exists
		GridStore.exist(dbConn, fileName, collName, function(err, result) {
			if (!result)
			{
				return callback(responseCodes.OK, false);
			}

			if (err) {
				return callback(responseCodes.DB_ERROR(err));
			}

			callback(responseCodes.OK, true);
		});
	});
};

/*******************************************************************************
 * Get a file from the Grid FS store
 *
 * @param {string} dbName     - Database name to get the file from
 * @param {string} collName   - Collection to get the file from
 * @param {string} fileName   - File name to retrieve
 * @param {function} callback - Callback function to return the file data
 *
 ******************************************************************************/
MongoWrapper.prototype.getGridFSFile = function(dbName, collName, fileName, callback)
{
	"use strict";
	var self = this;

	self.dbCallback(dbName, function (err, dbConn) {
		if (err.value) {
			return callback(err);
		}

		// Verify that the file exists
		self.existsGridFSFile(dbName, collName, fileName, function(err, result) {
			if (!result) {
				return callback(responseCodes.FILE_DOESNT_EXIST);
			}

			if (err.value) {
				return callback(err);
			}

			var options = {
				root : collName
			};

			var grid = new GridStore(dbConn, fileName, "r", options);

			grid.open(function (err, gs) {
				if (err) {
					return callback(responseCodes.DB_ERROR(err));
				}

				gs.seek(0, function() {
					gs.read(function(err, data) {
						if (err) {
							return callback(responseCodes.DB_ERROR(err));
						}

						callback(responseCodes.OK, new Binary(data));
					});
				});
			});
		});
	});
};

/*******************************************************************************
 * Store a file in the Grid FS store
 *
 * @param {string} dbName     - Database name to get the file from
 * @param {string} collName   - Collection to get the file from
 * @param {string} fileName   - File name to retrieve
 * @param {Object} data       - Data to store in object
 * @param {boolean} overwrite - If true, will overwrite existing files
 * @param {function} callback - Callback function to return the file data
 *
 ******************************************************************************/
MongoWrapper.prototype.storeGridFSFile = function(dbName, collName, fileName, data, overwrite, callback)
{
	"use strict";
	var self = this;

	self.dbCallback(dbName, function (err, dbConn) {
		if (err.value) {
			return callback(err);
		}

		var options = {
			root : collName
		};

		var storeFile = function () {
			var gs = new GridStore(dbConn, fileName, "w", options);

			gs.open(function (err, gs) {
				if (err) {
					return callback(responseCodes.DB_ERROR(err));
				}

				gs.write(data, function(err, gridStore) {
					if (err) {
						return callback(responseCodes.DB_ERROR(err));
					}

					gridStore.close(function(err, result) {
						if (err) {
							return callback(responseCodes.DB_ERROR(err));
						}

						callback(responseCodes.OK);
					});
				});
			});
		};

		if (overwrite)
		{
			// Verify that the file exists
			self.existsGridFSFile(dbName, collName, fileName, function(err, result) {
				if (err.value) {
					return callback(err);
				}

				if (result) {
					return callback(responseCodes.FILE_ALREADY_EXISTS);
				}

				storeFile();
			});
		} else {
			storeFile();
		}
	});
};

/*******************************************************************************
 * Run callback on collection from the database
 *
 * @param {string} dbName - Database name to run the aggregation on
 * @param {string} collName - Collection to run the aggregation on
 * @param {boolean} strict - Enable strict mode or not
 * @param {function} callback - get collection from database and pass to
 *								callback as parameter
 ******************************************************************************/
MongoWrapper.prototype.collCallback = function(dbName, collName, strict, callback) {
	"use strict";

	var self = this;
    // First get database connection
	self.dbCallback(dbName, function(err, dbConn) {
		if (err.value) {
			return callback(err);
		}

		// Get collection from database to act on
		dbConn.collection(collName, {strict:strict}, function(err, coll) {
			if (err) {
				return callback(responseCodes.DB_ERROR(err));
			}

			callback(responseCodes.OK, coll);
		});
	});
};

/*******************************************************************************
 * Get top result from query with latest timestamp
 *
 * @param {string} dbName - Database containing the collection for query
 * @param {string} collName - Collection to run the query on
 * @param {string} projection - Projection to use on results
 * @param {function} callback - get collection from database and pass to
 *								callback as parameter
 ******************************************************************************/
MongoWrapper.prototype.getLatest = function(dbName, collName, filter, projection, callback) {
	"use strict";

	var self = this;

	// Run collection callback that first sorts by timestamp
	// and then gets the top row.
	self.collCallback(dbName, collName, true, function(err, coll) {
		if (err.value) {
			return callback(err);
		}

		var projStr = JSON.stringify(projection);
		var filtStr = JSON.stringify(filter);

		self.logger.logDebug("Getting latest for collection: " + dbName + "/" + collName);
		self.logger.logDebug("FILTER: \"" + filtStr + "\"");
		self.logger.logDebug("PROJECTION: \"" + projStr + "\"");

		if (projection !== null)
		{
			coll.find(filter, projection).limit(1).sort({timestamp:-1}).toArray(function(err, docs) {
				if (err) {
					return callback(responseCodes.DB_ERROR(err));
				}

				self.logger.logDebug("Found " + docs.length + " result(s).");

				callback(responseCodes.OK, docs);
			});
		} else {
			coll.find(filter).limit(1).sort({timestamp:-1}).toArray(function(err, docs) {
				if (err) {
					return callback(responseCodes.DB_ERROR(err));
				}

				self.logger.logDebug("Found " + docs.length + " result(s).");

				callback(responseCodes.OK, docs);
			});
		}
	});
};

/*******************************************************************************
 * Get filtered collection from the database
 *
 * @param {string} dbName - Database name containing the collection
 * @param {string} collName - Collection to filter from the database
 * @param {JSON} filter - JSON containing filter query to run on collection
 * @param {JSON} projection - JSON containing projection for results
 * @param {function} callback - get filtered collection from database
 *								pass to callback as parameter
 ******************************************************************************/
MongoWrapper.prototype.filterColl = function(dbName, collName, filter, projection, callback) {
	"use strict";

	var self = this;

	this.collCallback(dbName, collName, true, function(err, coll) {
		if (err.value) {
			return callback(err);
		}

		var projStr = JSON.stringify(projection);
		var filtStr = JSON.stringify(filter);

		self.logger.logDebug("Filter collection: " + dbName + "/" + collName);
		self.logger.logDebug("FILTER: \"" + filtStr + "\"");
		self.logger.logDebug("PROJECTION: \"" + projStr + "\"");

		if (projection !== null) {
			coll.find(filter, projection).toArray(function(err, docs) {
				if (err) {
					return callback(responseCodes.DB_ERROR(err));
				}

				self.logger.logDebug("Found " + docs.length + " result(s).");

				callback(responseCodes.OK, docs);
			});
		} else {
			coll.find(filter).toArray(function(err, docs) {
				if (err) {
					return callback(responseCodes.DB_ERROR(err));
				}

				self.logger.logDebug("Found " + docs.length + " result(s).");

				callback(responseCodes.OK, docs);
			});
		}
	});
};

/*******************************************************************************
 * Get list of roles by database
 *
 * @param {string} dbName - Database name which holds the project
 * @param {number} readWriteAny - Select what permissions the role should have
 * @param {function} callback - function to return the list of roles
 ******************************************************************************/
MongoWrapper.prototype.getRolesByDatabase = function(dbName, readWriteAny, callback)
{
	"use strict";
	var collection = "system.roles";

	var filter = {};

	self.filterColl(dbName, collection, filter, {}, function (err, docs) {
		if (err.value)
		{
			return callback(err);
		}

		var rolesToReturn = [];

		for (var i = 0; i < docs.length; i++)
		{
			if (docs[i]["privileges"].length)
			{
				if (readWriteAny !== C.REPO_ANY)
				{
					var validActions= docs[i]["privileges"][0]["actions"];
					var privilegeType = 0;

					if (validActions.indexOf("find") !== -1) { privilegeType |= 1; };
					if (validActions.indexOf("insert") !== -1) { privilegeType |= 2; };

					if (privilegeType === readWriteAny)
					{
						rolesToReturn.push(docs[i]);
					}
				}
			}
		}

		return callback(responseCode.OK, rolesToReturn);
	});
};

/*******************************************************************************
 * Get list of roles by project
 *
 * @param {string} dbName - Database name which holds the project
 * @param {string} project - Project to which the permissions apply
 * @param {number} readWriteAny - A permission type filter (see constants.js)
 * @param {function} callback - function to return the list of roles
 ******************************************************************************/
MongoWrapper.prototype.getRolesByProject = function(dbName, project, readWriteAny, callback)
{
	"use strict";
	var collection = "system.roles";

	var filter = {};

	// Get all roles which have permissions on this project
	filter["privileges"] = { $elemMatch : { "resource.collection" : project + ".history" } };

	self.filterColl(dbName, collection, filter, {}, function (err, docs) {
		if (err.value)
		{
			return callback(err);
		}

		var rolesToReturn = [];

		for (var i = 0; i < docs.length; i++)
		{
			if (docs[i]["privileges"].length)
			{
				if (readWriteAny !== C.REPO_ANY)
				{
					var validActions= docs[i]["privileges"][0]["actions"];
					var privilegeType = 0;

					if (validActions.indexOf("find") !== -1) { privilegeType |= 1; };
					if (validActions.indexOf("insert") !== -1) { privilegeType |= 2; };

					if (privilegeType === readWriteAny)
					{
						rolesToReturn.push(docs[i]);
					}
				}
			}
		}

		return callback(responseCode.OK, rolesToReturn);
	});
};

// Get list of roles to check permissions on a project
// Get a user's current role for a project
// Get a list of valid roles for a project and their associated role.

/*******************************************************************************
 * Get settings for a particular role
 *
 * @param {string} dbName - Database name which holds the project
 * @param {array} roles - list of role names
 * @param {function} callback - function to return the list of roles
 ******************************************************************************/
MongoWrapper.prototype.getRoleSettings = function(dbName, roles, callback)
{
	"use strict";

	if (roles.constructor !== Array)
	{
		roles = [roles];
	}

	var filter = { _id : { $in : roles}};

	self.filterColl(database, "settings.roles", filter, {}, function (err, docs) {
		if (err.value)
		{
			return callback(err);
		}

		return callback(docs);
	});
};

MongoWrapper.prototype.getUserRolesForProject = function(database, project, username, callback)
{
	"use strict";

	self.getRolesByProject(database, project, C.REPO_ANY, function(err, projectRoles) {
		if (err.value)
		{
			return callback(err);
		}

		var projectRoleNames = projectRoles.map(function(projectRole) { return projectRole["_id"]; });

		self.getUserRoles(username, database, function(err, userRoles) {
			var userRoleNames = userRoles.map(function(userRole) { return userRole["_id"]; });
			var rolesToReturn = [];

			for(var i = 0; i < userRoleNames.length; i++)
			{
				if(projectRoleNames.indexOf(userRoleNames[i]) !== -1)
				{
					rolesToReturn.push(userRoles[i]);
				}
			}

			return callback(rolesToReturn);
		});
	});
};

/******************************************************************************
 * Get roles granted to a user within a specific database
 * The function will find all roles within the specified database and also
 * admin database and return this on the callback
 *
 * @param {string} username - username of the user
 * @param {string} database - database we are interested in
 * @param {function} callback - get filtered roles from database
 *								pass to callback as parameter
 ******************************************************************************/
MongoWrapper.prototype.getRoles = function (database, username, full, callback) {
	"use strict";
	var self = this;

	var dbName = "admin";
	var collName = "system.users";
	var filter = {};
	var rolesToReturn = [];

	// If the username is supplied, start by getting the roles just for this user
	if (username)
	{
		self.getUserRoles(username, dbName, function (err, userRoles)
		{
			if (err.value)
			{
				return callback(err);
			}

			var roleNames = userRoles.map( function (userRole) {
				return userRole["_id"].replace(".history", "");
			});

			self.getRoleSettings(database, roleNames, function(err, roleSettings)
			{
				for (var i = 0; i < roleNames.length; i++)
				{
					delete roleSettings[i]["_id"]; // Delete the ID attach to the settings
					_.extend(userRoles[i], roleSettings[i]);
				}

				return callback(responseCodes.OK, userRoles);
			});

		});
	} else {
		self.getRolesByDatabase(database, C.REPO_ANY, function(err, dbRoles) {
			if (err.value)
			{
				return callback(err);
			}

			var roleNames = dbRoles.map( function (dbRole) {
				return dbRole["_id"].replace(".history", "");
			});

			self.getRoleSettings(database, roleNames, function(err, roleSettings)
			{
				for (var i = 0; i < roleNames.length; i++)
				{
					delete roleSettings[i]["_id"]; // Delete the ID attach to the settings
					_.extend(dbRoles[i], roleSettings[i]);
				}

				return callback(responseCodes.OK, dbRoles);
			});
		});
	}
};

/*******************************************************************************
 * Get roles granted to a user within a specific database
 * The function will find all roles within the specified database and also
 * admin database and return this on the callback
 *
 * @param {string} username - username of the user
 * @param {string} database - database we are interested in
 * @param {function} callback - get filtered roles from database
 *								pass to callback as parameter
 ******************************************************************************/
MongoWrapper.prototype.getUserRoles = function (username, database, callback) {
	"use strict";
	var self = this;

	var dbName = "admin";
	var collName = "system.users"
	var filter = { "user" : username };

	//only return roles in admin and the specified database, the rest are irrelevant.
	var projection = { "roles" : 1};

	self.filterColl(dbName, collName, filter, projection, function(err, docs) {
		if (err.value) {
			return callback(err);
		}

		if (docs.length != 1) {
			self.logger.logError("Unexpected number of documents found in getUserRoles(). size:" + docs.length);
			return callback(responseCodes.USER_NOT_FOUND, docs);
		}

		var roles = [];
		for (i = 0; i < docs[0]["roles"].length; i++) {
			if (docs[0]["roles"][i]["db"] == dbName || docs[0]["roles"][i]["db"] == database) {
				roles.push(docs[0]["roles"][i]);
			}
		}

		callback(responseCodes.OK, roles);
	});
};

/*******************************************************************************
 * Get the list of privileges the user has on the database
 *
 * @param {string} username - username of the user
 * @param {string} database - database we are interested in
 * @param {function} callback - get filtered privileges from database
 *								pass to callback as parameter
 ******************************************************************************/
MongoWrapper.prototype.getUserPrivileges = function (username, database, callback) {
    "use strict";
    var self = this;

    var adminDB = "admin";

    //First get all the roles this user is granted within the databases of interest
     self.getUserRoles(username, database, function (status, roles) {
            if (status.value) {
                return callback(responseCodes.DB_ERROR(status));
            }

            if (!roles || roles.length == 0) {
                //no roles under this user, no point trying to find privileges
                return callback(responseCodes.OK, []);
        }

        self.dbCallback(adminDB, function (err, dbConn) {
            var command = { rolesInfo : roles, showPrivileges: true };
            //Given the roles, get the privilege information
            dbConn.command(command, function (err, docs) {
                if (err) {
                    return callback(responseCodes.DB_ERROR(err));
                }

                if (!docs || docs["roles"].length == 0) {
                    //No privileges return empty array
                    return callback(responseCodes.OK, []);
                }

                var rolesArr = docs["roles"];
                var privileges = [];

                for (i = 0; i < rolesArr.length; i++) {
                    privileges = privileges.concat(rolesArr[i]["inheritedPrivileges"]);
                }
                self.logger.logDebug(privileges.length + "privileges found.");
                callback(responseCodes.OK, privileges);
            });
        });
    });

};

module.exports = function(logger) {
	"use strict";

	return new MongoWrapper(logger);
};

