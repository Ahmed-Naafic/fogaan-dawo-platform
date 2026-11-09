/** Thin controllers for /api/v1/admin/users (administrator user management). */
import * as userService from './user.service.js';

/** POST /api/v1/admin/users/:userId/roles — assign role. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function assignRole(req, res) {
  const result = await userService.assignRole({ actorUserId: req.auth.user.id, userId: req.params.userId, role: req.body.role });
  res.status(201).json({ data: result });
}
