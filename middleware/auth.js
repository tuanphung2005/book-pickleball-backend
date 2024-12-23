const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const token = req.headers.authorization.split(' ')[1];
    const secret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Xác minh thất bại, hãy đăng xuất và đăng nhập lại!' });
  }
};