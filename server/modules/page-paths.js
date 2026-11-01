function slashlessAlias(pathname) {
  const escaped = String(pathname).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`);
}

module.exports = { slashlessAlias };
