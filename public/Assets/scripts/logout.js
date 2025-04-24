async function logout() {
    if (confirm("Are you sure you want to logout?")) {
        try {
            var response = await fetch("/mbkauthe/api/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });
            var data = await response.json();
            if (response.ok) {
                alert(data.message);
                clearAllCookies();
                window.location.reload();
            } else {
                alert(data.message);
            }
        } catch (error) {
            console.error("Error during logout:", error);
            alert("Logout failed");
        }
    }
}

function clearAllCookies() {
    var cookie;
    for (cookie of document.cookie.split("; ")) {
        var separatorIndex = cookie.indexOf("=");
        var cookieName = separatorIndex > -1 ? cookie.substr(0, separatorIndex) : cookie;
        document.cookie = cookieName + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    }
}