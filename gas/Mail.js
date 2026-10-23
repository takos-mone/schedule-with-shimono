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
  var items = rows.map(function (r) {
    return '<tr><td style="padding:6px 12px 6px 0;font-size:15px"><b>' + esc_(Slots.formatRange(r)) + '</b></td><td>'
      + btn_(admin + '?action=approve&id=' + encodeURIComponent(r.id), '承認', '#22a447') + '</td></tr>';
  }).join('');
  var html = '<div style="font-family:sans-serif;color:#1d1d1f">'
    + '<p><b>' + esc_(first.name) + '</b> さん（' + esc_(first.email) + '）から申請が届きました。</p>'
    + '<p>リンク：' + esc_(link.name) + '</p>'
    + (first.message ? '<p>ご用件：<br>' + esc_(first.message).replace(/\n/g, '<br>') + '</p>' : '')
    + '<table>' + items + '</table>'
    + '<p>' + btn_(admin + '?action=reply&req=' + encodeURIComponent(requestId) + '&type=modify', '修正を提案', '#ff9f2e')
    + btn_(admin + '?action=reply&req=' + encodeURIComponent(requestId) + '&type=reject', '却下', '#ff6b5e') + '</p>'
    + '<p style="font-size:12px;color:#666">ボタンが開けない場合（複数の Google アカウントでログイン中など）は'
    + '<a href="' + esc_(admin) + '">管理ページ</a>のリンク一覧から操作してください。</p></div>';
  MailApp.sendEmail({
    to: ownerEmail_(),
    subject: '【日程調整】' + link.name + ' から ' + rows.length + '件の申請',
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

function mailConfirmed_(r) {
  mailGuest_(r.email, '【日程確定】' + ownerName_() + 'との予定',
    '<p>' + esc_(r.name) + ' 様</p><p>以下の日時で確定しました。</p>'
    + '<p style="font-size:18px"><b>' + esc_(Slots.formatRange(r)) + '</b></p>'
    + '<p>' + esc_(ownerName_()) + '</p>');
}

function mailReply_(r, type, text) {
  var subject = type === 'reject' ? '【日程調整】申請について' : '【日程調整】日時のご相談';
  mailGuest_(r.email, subject,
    '<p>' + esc_(r.name) + ' 様</p><p>' + esc_(text).replace(/\n/g, '<br>') + '</p><p>' + esc_(ownerName_()) + '</p>');
}
