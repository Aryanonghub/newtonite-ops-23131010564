import { Box, Stack, Typography } from '@mui/material';
import { useState } from 'react';

// Newtonite's "N" mark (web/public/newtonite-logo.png, from newtonite.in) next to the product name.
// If the image fails to load, only the name is shown.
export const LOGO_SRC = '/newtonite-logo.png';

export function Brand({ dark = false, size = 28 }: { dark?: boolean; size?: number }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      {!logoFailed && (
        <Box component="img" src={LOGO_SRC} alt="" onError={() => setLogoFailed(true)}
          sx={{ width: size, height: size, borderRadius: size * 0.22, display: 'block',
            // On the dark sidebar the black square needs a faint edge to stand out.
            boxShadow: dark ? '0 0 0 1px rgba(255,255,255,0.14)' : 'none' }} />
      )}
      <Typography sx={{ fontWeight: 700, fontSize: size * 0.6, color: dark ? '#fff' : 'text.primary', letterSpacing: '-0.01em' }}>
        Newtonite Ops
      </Typography>
    </Stack>
  );
}
