FROM nginx:alpine

COPY eldt.html /usr/share/nginx/html/eldt.html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
