import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import appCss from "@/app/globals.css?url";
import fontsCss from "@/styles/tanstack-fonts.css?url";
import { Providers } from "@/components/providers";

// Same pre-hydration theme init as src/app/layout.tsx: applies a saved
// light/dark override before first paint so there is no theme flash.
const themeInit = `(function(){try{var t=localStorage.getItem('dr-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Debtrecover — N K Lodha & Co" },
      {
        name: "description",
        content:
          "Assisted B2B debt recovery workflow: reminders, GST communications, MSME ODR filing, and payment confirmation.",
      },
    ],
    links: [
      { rel: "stylesheet", href: fontsCss },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    // suppressHydrationWarning: themeInit sets data-theme before hydration.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <HeadContent />
      </head>
      <body className="min-h-full">
        <Providers>
          <Outlet />
        </Providers>
        <Scripts />
      </body>
    </html>
  );
}
