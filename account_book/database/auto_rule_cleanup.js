// Remove only generated AUTO rules that fail to parse their source notification.
// Related files: routes/webhook.js and routes/rules.js.
async function removeUnusableAutoRule(db, ruleId, parseResult) {
  if (parseResult || !Number.isInteger(ruleId) || ruleId <= 0) {
    return false;
  }
  const result = await db.run("DELETE FROM rules WHERE id = ? AND source = 'AUTO'", [ruleId]);
  return result.changes > 0;
}

module.exports = { removeUnusableAutoRule };
