const Joi = require('joi');

const createComplaintSchema = {
  body: Joi.object({
    complaint_number: Joi.string().max(100).allow('', null).optional(),
    photo_url: Joi.string().allow('', null).optional(),
    category: Joi.string().min(2).max(100).required(),
    title: Joi.string().min(3).max(200).required(),
    description: Joi.string().max(2000).allow('', null).optional(),
    priority: Joi.string().valid('Low', 'Medium', 'High', 'Critical').default('Medium'),
    department_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string()).allow('', null).optional(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    location_source: Joi.string().valid('exif', 'device_gps', 'map_pin', 'map_pin_confirmed', 'live_gps', 'exif_gps', 'manual_pin').default('map_pin').optional(),
    location_accuracy_m: Joi.number().min(0).allow(null).optional(),
    location_accuracy: Joi.number().min(0).allow(null).optional(),
    location_address: Joi.string().max(500).allow('', null).optional(),
    duplicate_of_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string()).allow('', null).optional()
  }).unknown(true)
};

const updateStatusSchema = {
  body: Joi.object({
    status: Joi.string().valid('Submitted', 'Assigned', 'In Progress', 'Resolved', 'Reopened', 'Overdue').required(),
    remark: Joi.string().max(1000).allow('', null).optional(),
    department: Joi.string().max(150).allow('', null).optional()
  }),
  params: Joi.object({
    id: Joi.number().integer().positive().required()
  })
};

const addFeedbackSchema = {
  body: Joi.object({
    complaint_id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string()).optional(),
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().max(1000).allow('', null).optional(),
    citizen_name: Joi.string().allow('', null).optional()
  }).unknown(true)
};

module.exports = {
  createComplaintSchema,
  updateStatusSchema,
  addFeedbackSchema
};
