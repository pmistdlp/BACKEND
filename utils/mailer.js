const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'salmanparies18@gmail.com',
    pass: 'icqo ymfz jyew ilug'
  }
});

module.exports = transporter;