import React from 'react';

export default function HcBlockPreview() {
  return (
    <div
      style={{
        padding: '14px',
        borderRadius: '8px',
        background: 'linear-gradient(135deg, #0c1f4d 0%, #123a86 100%)',
        color: '#fff'
      }}
    >
      <div
        style={{
          width: '34%',
          height: '5px',
          marginBottom: '10px',
          borderRadius: '3px',
          background: 'rgba(255,255,255,.55)'
        }}
      />
      <div
        style={{
          width: '78%',
          height: '11px',
          marginBottom: '7px',
          borderRadius: '4px',
          background: 'rgba(255,255,255,.95)'
        }}
      />
      <div
        style={{
          width: '58%',
          height: '11px',
          marginBottom: '14px',
          borderRadius: '4px',
          background: '#5f8dff'
        }}
      />
      <div style={{ display: 'flex', gap: '7px' }}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            style={{
              flex: 1,
              height: '26px',
              borderRadius: '5px',
              background: 'rgba(255,255,255,.18)'
            }}
          />
        ))}
      </div>
    </div>
  );
}
