import GoogleIcon from "@mui/icons-material/Google";
import MicrosoftIcon from "@mui/icons-material/Window";
import { Box, Button, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { buildCognitoLoginAuthorizeUrl } from "./buildAuthorizeUrl.ts";

export type CognitoLoginCardProps = {
  /** Base path for authorize (e.g. "/oauth/authorize"). */
  authorizePath: string;
  /** Return URL after login (optional). */
  returnUrl?: string;
  /** Page title (e.g. "CASFA"). */
  title?: string;
  /** Subtitle below title (e.g. "Content-Addressable Storage for Agents"). */
  subtitle?: string;
};

export function CognitoLoginCard(props: CognitoLoginCardProps): ReactNode {
  const {
    authorizePath,
    returnUrl,
    title = "CASFA",
    subtitle = "Content-Addressable Storage for Agents",
  } = props;

  const getHref = (identityProvider: string) =>
    buildCognitoLoginAuthorizeUrl({ authorizePath, returnUrl, identityProvider });

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="grey.50"
    >
      <Card sx={{ maxWidth: 420, width: "100%", mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" textAlign="center" gutterBottom fontWeight={600}>
            {title}
          </Typography>
          <Typography variant="body2" textAlign="center" color="text.secondary" mb={3}>
            {subtitle}
          </Typography>

          <Stack spacing={2}>
            <Divider>
              <Typography variant="body2" color="text.secondary">
                Sign in with
              </Typography>
            </Divider>

            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={<GoogleIcon />}
              href={getHref("Google")}
              sx={{ textTransform: "none", py: 1.5 }}
            >
              Continue with Google
            </Button>

            <Button
              variant="outlined"
              size="large"
              fullWidth
              startIcon={<MicrosoftIcon />}
              href={getHref("Microsoft")}
              sx={{ textTransform: "none", py: 1.5 }}
            >
              Continue with Microsoft
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
