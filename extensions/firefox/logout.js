// End only the ILIAS browser session; SWITCH SSO cookies are not touched.
globalThis.BetterIliasClearIliasCookies = async () => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const cookies = await api.cookies.getAll({ domain:'ilias.unibe.ch' });
  for (const cookie of cookies) {
    if (cookie.domain.replace(/^\./,'') !== 'ilias.unibe.ch' ||
        !(cookie.name==='PHPSESSID' || cookie.name.startsWith('_shibsession_') || cookie.name.startsWith('il_'))) continue;
    const details={url:'https://ilias.unibe.ch'+cookie.path,name:cookie.name,storeId:cookie.storeId};
    if(cookie.partitionKey)details.partitionKey=cookie.partitionKey;
    if(typeof browser!=='undefined' && cookie.firstPartyDomain!==undefined)details.firstPartyDomain=cookie.firstPartyDomain;
    await api.cookies.remove(details);
  }
};
globalThis.BetterIliasClearAppCookies=async (...origins)=>{
  const api=typeof browser!=='undefined'?browser:chrome;
  for(const origin of new Set(origins)) {
    const target=new URL('/api/',origin);
    for(const cookie of await api.cookies.getAll({url:target.href})) {
      if(cookie.name!=='betterilias_session'||cookie.domain.replace(/^\./,'')!==target.hostname)continue;
      const details={url:new URL(cookie.path,origin).href,name:cookie.name,storeId:cookie.storeId};
      if(cookie.partitionKey)details.partitionKey=cookie.partitionKey;
      if(typeof browser!=='undefined'&&cookie.firstPartyDomain!==undefined)details.firstPartyDomain=cookie.firstPartyDomain;
      await api.cookies.remove(details);
    }
  }
};
