import { Box, Stack, Typography } from '@mui/material';
import { useState } from 'react';

// Logo file: web/public/newtonite-logo.png. If it is missing or fails to load, a plain wordmark is shown instead.
const LOGO_SRC = '/newtonite-logo.png';

export function Brand({ dark = false, size = 28 }: { dark?: boolean; size?: number }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      {!logoFailed && (
        <Box component="img" src={LOGO_SRC} alt="Newtonite" onError={() => setLogoFailed(true)}
          sx={{ height: size, width: 'auto', display: 'block' }} />
      )}
      <Typography sx={{ fontWeight: 700, fontSize: size * 0.6, color: dark ? '#fff' : 'text.primary', letterSpacing: '-0.01em' }}>
        {logoFailed ? 'Newtonite Ops' : 'Ops'}
      </Typography>
    </Stack>
  );
}
