// A positive integer id from a URL param or body field, or null (-> 400 in the controller).
function parseId(raw) {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { parseId };
