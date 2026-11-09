/** Data access: find setting by key (platformSetting.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findSettingByKey = (client, key) => client.platformSetting.findUnique({ where: { key } });
