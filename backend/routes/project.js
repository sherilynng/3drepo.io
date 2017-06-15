
(function() {
	"use strict";

	const express = require('express');
	const router = express.Router({mergeParams: true});
	const responseCodes = require('../response_codes');
	const middlewares = require('./middlewares');
	const Project = require("../models/project");
	const utils = require("../utils");
	const C = require("../constants");
	const checkPermissions = middlewares.checkPermissions;
	
	router.post("/projects", checkPermissions([C.PERM_CREATE_PROJECT]), createProject);
	router.put("/projects/:project", checkPermissions([C.PERM_EDIT_PROJECT]), updateProject);
	router.delete("/projects/:project", checkPermissions([C.PERM_DELETE_PROJECT]), deleteProject);


	function createProject(req, res, next){
		Project.createProject(req.params.teamspace, req.body.name).then(project => {
			responseCodes.respond(utils.APIInfo(req), req, res, next, responseCodes.OK, project);
		}).catch(err => {
			responseCodes.respond(utils.APIInfo(req), req, res, next, err, err);
		});
	}


	function updateProject(req, res, next){

		Project.findOne({ teamspace: req.params.teamspace }, {name: req.params.project}).then(project => {
			if(!project){
				return Promise.reject(responseCodes.PROJECT_NOT_FOUND);
			} else {
				return project.updateAttrs(req.body);
			}
		}).then(project => {
			responseCodes.respond(utils.APIInfo(req), req, res, next, responseCodes.OK, project);
		}).catch(err => {
			responseCodes.respond(utils.APIInfo(req), req, res, next, err, err);
		});
	}

	function deleteProject(req, res, next){
		
		Project.delete(req.params.teamspace, req.params.project).then(project => {
			responseCodes.respond(utils.APIInfo(req), req, res, next, responseCodes.OK, project);
		}).catch(err => {
			responseCodes.respond(utils.APIInfo(req), req, res, next, err, err);
		});
	}

	module.exports = router;

}());

