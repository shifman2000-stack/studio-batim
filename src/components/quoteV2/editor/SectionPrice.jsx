import { computePayments, formatMoney } from '../../../lib/quoteV2/payments'
import { pctSum } from '../../../lib/quoteV2/validate'

/* 2 · המחיר — שכר הטרחה וחלוקת התשלומים.

   ⚠️ הסכומים מחושבים ב-computePayments, אותה פונקציה שמזינה את
   הפן השיווקי ואת ה-PDF. חישוב מקומי כאן היה המקום הקלאסי שבו
   העורך מראה 18,000 וה-PDF מראה 17,999. */

export default function SectionPrice({ stages, fee, readOnly, onFee, onPct, feeNote }) {
  const sum = pctSum(stages)
  const amounts = computePayments(fee, stages.map(s => s.pct))

  return (
    <div className="qe-sec">
      <h2><span className="qe-n">2</span>המחיר</h2>
      <div className="qe-pad">
        <div className="qe-fee">
          <input
            value={fee ? Number(fee).toLocaleString('en-US') : ''}
            inputMode="numeric"
            placeholder="0"
            disabled={readOnly}
            aria-label="שכר טרחה"
            onChange={e => onFee(e.target.value.replace(/[^\d]/g, ''))}
          />
          <span>₪ בתוספת מע״מ</span>
        </div>
        {feeNote && <div className="qe-opt" style={{ marginTop: 6 }}>{feeNote}</div>}

        {stages.length > 0 && (
          <table className="qe-split">
            <tbody>
              {stages.map((s, i) => (
                <tr key={s.id}>
                  <td>{s.formalName || <span style={{ color: '#c0653a' }}>שלב בלי שם</span>}</td>
                  <td className="pc">
                    <input
                      value={s.pct ?? 0}
                      inputMode="numeric"
                      disabled={readOnly}
                      aria-label={`אחוז לשלב ${i + 1}`}
                      onChange={e => onPct(s.id, e.target.value)}
                    />%
                  </td>
                  <td className="amt">{formatMoney(amounts[i] ?? 0)} ₪</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className={'qe-sum' + (sum === 100 ? '' : ' bad')}>
          {sum === 100 ? '✓ סה״כ 100%' : `סה״כ ${sum}% — צריך להגיע ל-100%`}
        </div>
      </div>
    </div>
  )
}
