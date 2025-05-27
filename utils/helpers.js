const moment = require('moment-timezone');

const getISTTimestamp = () => moment().tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

module.exports = { getISTTimestamp };