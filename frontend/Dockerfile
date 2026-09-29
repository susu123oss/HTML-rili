FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css theme.css theme-init.js app.js sidebar_preview.html pm_preview.html /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY libs /usr/share/nginx/html/libs
COPY marked /usr/share/nginx/html/marked
COPY webfonts /usr/share/nginx/html/webfonts
COPY vendor /usr/share/nginx/html/vendor
