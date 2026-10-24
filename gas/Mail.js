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

function durationLabel_(r) {
  var m = Math.round((r.end - r.start) / 60000);
  return (m >= 60 ? Math.floor(m / 60) + '時間' : '') + (m % 60 ? (m % 60) + '分' : '');
}

var STATUS_JA = { pending: '確認中', approved: '確定', rejected: 'お受けできません' };

// Summary of one request for guest mails: times (with duration/status), ご用件, 備考, applied at.
function requestSummaryHtml_(rows, showStatus) {
  var r = rows[0];
  var cell = 'padding:6px 10px;border-bottom:1px solid #e5e5ea;vertical-align:top';
  var head = 'padding:6px 10px;border-bottom:1px solid #e5e5ea;color:#6e6e73;white-space:nowrap;vertical-align:top';
  var times = rows.map(function (x) {
    return '<div style="margin:2px 0"><b>' + esc_(Slots.formatRange(x)) + '</b>（' + esc_(durationLabel_(x)) + '）'
      + (showStatus ? ' <span style="font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid #1d1d1f;background:'
        + (x.status === 'approved' ? '#eaf7ee' : x.status === 'rejected' ? '#fde2df' : '#fff3cd') + '">' + STATUS_JA[x.status] + '</span>' : '')
      + '</div>';
  }).join('');
  var row = function (k, v) { return '<tr><td style="' + head + '">' + k + '</td><td style="' + cell + '">' + v + '</td></tr>'; };
  return '<table style="border-collapse:collapse;border:2px solid #1d1d1f;border-radius:8px;margin:12px 0;font-size:14px">'
    + row('相手', esc_(ownerName_()))
    + row('日時', times)
    + (r.message ? row('ご用件', esc_(r.message).replace(/\n/g, '<br>')) : '')
    + (r.note ? row('備考・コメント', esc_(r.note).replace(/\n/g, '<br>')) : '')
    + row('お名前', esc_(r.name) + ' 様')
    + row('申請日時', esc_(Utilities.formatDate(new Date(r.createdAt), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')))
    + '</table>';
}

function subjectTopic_(r) {
  return r.message ? '（' + r.message.split('\n')[0].slice(0, 20) + '）' : '';
}

// rows: approved ranges of one request (same guest); sends a single mail listing all of them.
function mailConfirmed_(rows) {
  var r = rows[0];
  var first = Slots.formatRange(rows[0]) + (rows.length > 1 ? ' ほか' + (rows.length - 1) + '件' : '');
  mailGuest_(r.email, '【日程確定】' + first + ' ' + ownerName_() + 'との予定' + subjectTopic_(r),
    '<p>' + esc_(r.name) + ' 様</p><p>お申し込みいただいた日程が確定しました。</p>'
    + requestSummaryHtml_(rows, false)
    + '<p style="font-size:13px;color:#6e6e73">変更やキャンセルが必要な場合は、このメールにご返信ください。</p>'
    + '<p>' + esc_(ownerName_()) + '</p>');
}

// rows: every range of the request, so the guest sees which times this mail is about.
function mailReply_(rows, type, text) {
  var r = rows[0];
  var subject = (type === 'reject' ? '【日程調整】お申し込みについて' : '【日程調整】日時のご相談') + subjectTopic_(r);
  mailGuest_(r.email, subject,
    '<p>' + esc_(r.name) + ' 様</p><p>' + esc_(text).replace(/\n/g, '<br>') + '</p>'
    + '<p style="margin-top:20px;font-size:13px;color:#6e6e73">お申し込みいただいた内容：</p>'
    + requestSummaryHtml_(rows, true)
    + '<p>' + esc_(ownerName_()) + '</p>');
}
