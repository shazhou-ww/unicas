import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";

export function LoginErrorView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in failed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          The Google sign-in could not be completed. Your session state did not
          match the provider response, or the identity provider rejected the
          request. Please try again.
        </p>
        <p><a href="/admin/auth/login">Start sign-in again</a></p>
      </CardContent>
    </Card>
  );
}
