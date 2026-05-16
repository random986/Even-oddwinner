<?php
// contact.php - Token Exchange Handler
// Handles the token exchange server-side and redirects back to the React app

$client_id = $_POST['client_id'] ?? '';
$code = $_POST['code'] ?? '';
$redirect_uri = $_POST['redirect_uri'] ?? '';
$code_verifier = $_POST['code_verifier'] ?? '';

if (!$code) {
    die("No authorization code provided.");
}

$postData = http_build_query([
    'grant_type' => 'authorization_code',
    'client_id' => $client_id,
    'code' => $code,
    'redirect_uri' => $redirect_uri,
    'code_verifier' => $code_verifier
]);

$ch = curl_init('https://auth.deriv.com/oauth2/token');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $postData,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
    CURLOPT_TIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => false // Prevent cPanel SSL issues
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    die("cURL Error during token exchange: " . htmlspecialchars($error));
}

$data = json_decode($response, true);

if (isset($data['access_token'])) {
    // Successfully got the access token!
    // Pass it back to the React app via sessionStorage and redirect
    echo "<!DOCTYPE html><html><head><title>Authenticating...</title></head><body style='background:#1a1a2e;color:white;text-align:center;padding:50px;font-family:sans-serif;'>";
    echo "<h2>Authentication Successful! Redirecting...</h2>";
    echo "<script>";
    echo "sessionStorage.setItem('oauth_token_raw', " . json_encode($response) . ");";
    echo "window.location.href = '/';";
    echo "</script>";
    echo "</body></html>";
} else {
    // Show exact Deriv error if it fails
    echo "<!DOCTYPE html><html><head><title>Error</title></head><body style='background:#1a1a2e;color:white;padding:20px;font-family:sans-serif;'>";
    echo "<h2>Token Exchange Failed</h2>";
    echo "<p>Deriv rejected the token exchange with the following response:</p>";
    echo "<pre style='background:#0f0f1a;padding:15px;border-radius:5px;'>" . htmlspecialchars($response) . "</pre>";
    echo "<br><a href='/' style='color:#00ff88;'>Go Back</a>";
    echo "</body></html>";
}
?>
