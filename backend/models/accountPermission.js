/**
 *  Copyright (C) 2017 3D Repo Ltd
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as
 *  published by the Free Software Foundation, either version 3 of the
 *  License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

(() => {
	"use strict";

	const mongoose = require("mongoose");
	const schema = mongoose.Schema({
		_id: false,
		user: String,
		permissions: [String]
	});
	const responseCodes = require('../response_codes.js');
	const C = require('../constants');
	const _ = require('lodash');

	const methods = {
		init: function(user, permissions) {

			this.user = user;
			this.permissions = permissions;
			return this;
		},

		findByUser: function(user){
			return this.permissions.find(perm => perm.user === user);
		},

		_check(user, permission){

			const User = require('./user');
			
			return User.findByUserName(user).then(user => {
				if(!user){
					return Promise.reject(responseCodes.USER_NOT_FOUND);
				}
			}).then(() => {

				const isPermissionInvalid = permission.permissions && 
					_.intersection(permission.permissions, C.ACCOUNT_PERM_LIST).length !== permission.permissions.length;

				if (isPermissionInvalid) {
					return Promise.reject(responseCodes.INVALID_PERM);
				}
			});
		},

		add: function(permission){

			return this._check(permission.user, permission).then(() => {
				
				if(this.findByUser(permission.user)){
					return Promise.reject(responseCodes.DUP_ACCOUNT_PERM);
				}

				this.permissions.push(permission);
				return this.user.save().then(() => permission);

			});
		},

		update: function(user, permission){

			return this._check(user, permission).then(() => {

				const currPermission = this.findByUser(user);

				if(currPermission){
					currPermission.permissions = permission.permissions;
				} else {
					return Promise.reject(responseCodes.ACCOUNT_PERM_NOT_FOUND);
				}

				return this.user.save().then(() => permission);
			});
		},

		remove: function(user){

			let index = -1;
			
			this.permissions.find((perm, i) => {
				if(perm.user === user){
					index = i;
					return true;
				}
			});

			if (index === -1) {
				return Promise.reject(responseCodes.ACCOUNT_PERM_NOT_FOUND);
			} else {
				this.permissions.splice(index, 1);
				return this.user.save();
			}

		}
	};

	// Mongoose doesn't support subschema static method
	module.exports = {
		schema, methods
	};

})();