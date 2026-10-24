// Gmail notifications. All mail is sent from the owner's account via MailApp.

function ownerEmail_() {
  return Session.getEffectiveUser().getEmail();
}

function ownerName_() {
  return getSetting_('ownerName', '下野');
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function btn_(href, label, color) {
  return '<a href="' + esc_(href) + '" style="display:inline-block;padding:8px 16px;margin:2px 4px 2px 0;border:2px solid #1d1d1f;'
    + 'border-radius:8px;background:' + color + ';color:#fff;font-weight:700;text-decoration:none">' + esc_(label) + '</a>';
}

function notifyOwner_(link, requestId, rows) {
  var first = rows[0];
  var admin = ENV.ADMIN_URL;
  var req = encodeURIComponent(requestId);
  var items = rows.map(function (r) {
    return '<li style="font-size:15px;margin:2px 0"><b>' + esc_(Slots.formatRange(r)) + '</b></li>';
  }).join('');
  var html = '<div style="font-family:sans-serif;color:#1d1d1f">'
    + '<p><b>' + esc_(first.name) + '</b> さん（' + esc_(first.email) + '）から申請が届きました。</p>'
    + '<p>リンク：' + esc_(link.name) + '</p>'
    + '<p>希望の日時：</p><ul style="margin-top:0">' + items + '</ul>'
    + (first.message ? '<p>ご用件：<br>' + esc_(first.message).replace(/\n/g, '<br>') + '</p>' : '')
    + (first.note ? '<p>備考・コメント：<br>' + esc_(first.note).replace(/\n/g, '<br>') + '</p>' : '')
    + '<p>' + btn_(admin + '?action=approve&req=' + req, rows.length > 1 ? 'すべて承認' : '承認', '#22a447')
    + btn_(admin + '?action=reply&req=' + req + '&type=modify', '修正を提案', '#ff9f2e')
    + btn_(admin + '?action=reply&req=' + req + '&type=reject', '却下', '#ff6b5e') + '</p>'
    + (rows.length > 1 ? '<p style="font-size:12px;color:#666">一部だけ承認したい場合や時刻を調整したい場合は、管理ページのリンク一覧から操作してください。</p>' : '')
    + '<p style="font-size:12px;color:#666">ボタンが開けない場合（複数の Google アカウントでログイン中など）は'
    + '<a href="' + esc_(admin) + '">管理ページ</a>から操作してください。</p></div>';
  MailApp.sendEmail({
    to: ownerEmail_(),
    subject: '【日程調整】' + first.name + ' さんから申請（' + rows.length + '件の日時）',
    htmlBody: html,
    name: '日程調整 with ' + ownerName_(),
  });
}

function mailGuest_(to, subject, bodyHtml) {
  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: '<div style="font-family:sans-serif;color:#1d1d1f">' + bodyHtml + '</div>',
    name: ownerName_(),
    replyTo: ownerEmail_(),
  });
}

// rows: approved ranges of one request (same guest); sends a single mail listing all of them.
function mailConfirmed_(rows) {
  var r = rows[0];
  mailGuest_(r.email, '【日程確定】' + ownerName_() + 'との予定',
    '<p>' + esc_(r.name) + ' 様</p><p>以下の日時で確定しました。</p>'
    + rows.map(function (x) { return '<p style="font-size:18px;margin:4px 0"><b>' + esc_(Slots.formatRange(x)) + '</b></p>'; }).join('')
    + '<p>' + esc_(ownerName_()) + '</p>');
}

function mailReply_(r, type, text) {
  var subject = type === 'reject' ? '【日程調整】申請について' : '【日程調整】日時のご相談';
  mailGuest_(r.email, subject,
    '<p>' + esc_(r.name) + ' 様</p><p>' + esc_(text).replace(/\n/g, '<br>') + '</p><p>' + esc_(ownerName_()) + '</p>');
}
