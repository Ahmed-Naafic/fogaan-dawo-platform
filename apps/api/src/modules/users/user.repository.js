/** Ids of every user holding the ADMIN role. */
export async function findAdminUserIds(client) {
  const admins = await client.user.findMany({ where: { roles: { some: { role: { name: 'ADMIN' } } } }, select: { id: true } });
  return admins.map((a) => a.id);
}

export const updateUserFullName = (client, userId, fullName) =>
  client.user.update({ where: { id: userId }, data: { fullName }, select: { id: true } });
