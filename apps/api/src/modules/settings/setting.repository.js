export const findSettingByKey = (client, key) => client.platformSetting.findUnique({ where: { key } });
