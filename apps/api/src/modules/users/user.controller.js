import * as userService from './user.service.js';

export async function assignRole(req, res) {
  const result = await userService.assignRole({ actorUserId: req.auth.user.id, userId: req.params.userId, role: req.body.role });
  res.status(201).json({ data: result });
}
