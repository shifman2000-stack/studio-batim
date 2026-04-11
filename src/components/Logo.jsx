import React from 'react';
export default function Logo() {
  return (
    <div style={{ textDecoration: 'none', direction: 'rtl', display: 'flex', alignItems: 'center', gap: 0 }}>
      <span style={{
        fontFamily: "'Heebo', sans-serif",
        fontWeight: 200,
        fontSize: '9px',
        letterSpacing: '0.28em',
        color: '#8a8680',
        direction: 'ltr',
        whiteSpace: 'nowrap'
      }}>BY EINAV SHIFMAN</span>
      <span style={{
        display: 'block',
        width: '1px',
        height: '28px',
        flexShrink: 0,
        background: 'linear-gradient(to bottom, transparent, #c8bfb0 25%, #c8bfb0 75%, transparent)',
        margin: '0 16px'
      }} />
      <span style={{
        fontFamily: "'Rubik', sans-serif",
        fontWeight: 300,
        fontSize: '30px',
        letterSpacing: '0.06em',
        color: '#1a1a18',
        lineHeight: 1,
        whiteSpace: 'nowrap'
      }}>סטודיו בתים</span>
    </div>
  );
}
