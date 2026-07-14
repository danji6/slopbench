export function AntiFlashbang() {
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: needed for this to work
      dangerouslySetInnerHTML={{
        __html:
          '(function(){document.documentElement.classList.add("dark")})();',
      }}
    />
  )
}
