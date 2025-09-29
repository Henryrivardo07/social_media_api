const successResponse = (res, data = null, message = "OK", status = 200) =>
  res.status(status).json({ success: true, message, data });

const errorResponse = (
  res,
  message = "Something went wrong",
  status = 500,
  data = null
) => res.status(status).json({ success: false, message, data });

module.exports = { successResponse, errorResponse };
